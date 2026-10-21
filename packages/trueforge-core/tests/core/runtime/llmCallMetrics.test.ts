import type { ILLM } from '../../../src/core/llm/ILLM';
import type {
  ExtendedChatCompletionChunk,
  FinishReason,
  RawAssistantMessageWithUsage,
} from '../../../src/core/llm/LLMTypes';
import type {
  LlmFinishReason,
  LlmProviderType,
  LlmRequestOutcome,
  OperationMetrics,
} from '../../../src/core/observability/operationMetrics';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger, TEST_MODEL_NAME } from '../harnessMocks';

const silentLogger = makeSilentLogger();

interface RecordedLlmRequest {
  providerType: LlmProviderType;
  outcome: LlmRequestOutcome;
  finishReason: LlmFinishReason;
  durationSeconds: number;
}

interface RecordedTimeToFirstToken {
  providerType: LlmProviderType;
  durationSeconds: number;
}

function recordingMetrics(): {
  metrics: OperationMetrics;
  requests: RecordedLlmRequest[];
  timeToFirstToken: RecordedTimeToFirstToken[];
} {
  const requests: RecordedLlmRequest[] = [];
  const timeToFirstToken: RecordedTimeToFirstToken[] = [];
  return {
    requests,
    timeToFirstToken,
    metrics: {
      recordOutboundHttpRequest(): void {},
      recordOutboundHttpRetry(): void {},
      recordLlmRequest(options): void {
        requests.push(options);
      },
      recordLlmTimeToFirstToken(options): void {
        timeToFirstToken.push(options);
      },
      recordLlmStreamError(): void {},
    },
  };
}

function completedMessage(finishReason: FinishReason | null): RawAssistantMessageWithUsage {
  return {
    output: { role: 'assistant', content: 'partial' },
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    finish_reason: finishReason,
  };
}

function textChunk(finishReason: FinishReason | null): ExtendedChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { content: 'partial', role: 'assistant' },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* streamEndingWith(
  finishReason: FinishReason | null,
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield textChunk(finishReason);
  return completedMessage(finishReason);
}

async function drain(thread: AgentThread, signal: AbortSignal): Promise<void> {
  for await (const event of thread.execute({ signal })) {
    void event;
  }
}

function threadFor({
  modelClient,
  metrics,
  providerType,
}: {
  modelClient: ILLM;
  metrics: OperationMetrics | undefined;
  providerType: LlmProviderType | undefined;
}): AgentThread {
  return new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger: silentLogger,
    ...(metrics !== undefined ? { operationMetrics: metrics } : {}),
    definition: {
      modelClient,
      modelName: TEST_MODEL_NAME,
      instruction: 'test',
      toolSets: [],
      ...(providerType !== undefined ? { providerType } : {}),
    },
    context: [{ role: 'user', content: 'hi' }],
  });
}

describe('AgentThread model call metrics', () => {
  it('records one successful call and time to first token', async () => {
    const recorded = recordingMetrics();
    const modelClient: ILLM = {
      create: () => streamEndingWith('stop'),
      createNonStream: jest.fn(),
    };
    await drain(
      threadFor({ modelClient, metrics: recorded.metrics, providerType: 'openai' }),
      new AbortController().signal,
    );

    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]).toMatchObject({
      providerType: 'openai',
      outcome: 'success',
      finishReason: 'stop',
    });
    expect(recorded.requests[0]?.durationSeconds).toEqual(expect.any(Number));
    expect(recorded.timeToFirstToken).toHaveLength(1);
    expect(recorded.timeToFirstToken[0]).toMatchObject({ providerType: 'openai' });
  });

  it('uses none when the stream ends without a finish reason', async () => {
    const recorded = recordingMetrics();
    const modelClient: ILLM = {
      create: () => streamEndingWith(null),
      createNonStream: jest.fn(),
    };
    await drain(
      threadFor({ modelClient, metrics: recorded.metrics, providerType: 'anthropic' }),
      new AbortController().signal,
    );

    expect(recorded.requests[0]).toMatchObject({ outcome: 'success', finishReason: 'none' });
  });

  it('records an error and skips time to first token when the stream throws first', async () => {
    const recorded = recordingMetrics();
    const modelClient: ILLM = {
      // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture
      create: async function* () {
        throw new Error('provider down');
      },
      createNonStream: jest.fn(),
    };
    await drain(
      threadFor({ modelClient, metrics: recorded.metrics, providerType: 'openai' }),
      new AbortController().signal,
    );

    expect(recorded.requests).toEqual([
      expect.objectContaining({ outcome: 'error', finishReason: 'none', providerType: 'openai' }),
    ]);
    expect(recorded.timeToFirstToken).toHaveLength(0);
  });

  it('records an abort when the provider stream is cancelled', async () => {
    const recorded = recordingMetrics();
    const modelClient: ILLM = {
      // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture
      create: async function* () {
        const aborted = new Error('LLM stream aborted');
        aborted.name = 'AbortError';
        throw aborted;
      },
      createNonStream: jest.fn(),
    };
    await drain(
      threadFor({ modelClient, metrics: recorded.metrics, providerType: 'google-gemini' }),
      new AbortController().signal,
    );

    expect(recorded.requests[0]).toMatchObject({ outcome: 'aborted', finishReason: 'none' });
  });

  it('records an abort with the finish reason when the signal trips after the stream', async () => {
    const recorded = recordingMetrics();
    const controller = new AbortController();
    const modelClient: ILLM = {
      // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture
      create: async function* () {
        yield textChunk('stop');
        controller.abort();
        return completedMessage('stop');
      },
      createNonStream: jest.fn(),
    };
    await drain(threadFor({ modelClient, metrics: recorded.metrics, providerType: 'openai' }), controller.signal);

    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]).toMatchObject({ outcome: 'aborted', finishReason: 'stop' });
    expect(recorded.timeToFirstToken).toHaveLength(1);
  });

  it('skips recording when the definition has no provider type', async () => {
    const recorded = recordingMetrics();
    const modelClient: ILLM = {
      create: () => streamEndingWith('stop'),
      createNonStream: jest.fn(),
    };
    await drain(
      threadFor({ modelClient, metrics: recorded.metrics, providerType: undefined }),
      new AbortController().signal,
    );

    expect(recorded.requests).toHaveLength(0);
    expect(recorded.timeToFirstToken).toHaveLength(0);
  });
});
