import type { ILLM } from '../../../src/core/llm/ILLM';
import type {
  ExtendedChatCompletionChunk,
  FinishReason,
  RawAssistantMessageWithUsage,
} from '../../../src/core/llm/LLMTypes';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { InternalEventType, type InternalThreadDoneEvent } from '../../../src/core/runtime/AgentThread.types';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger, TEST_MODEL_NAME } from '../harnessMocks';

const silentLogger = makeSilentLogger();
const OUTPUT_TOKENS = 4096;

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* streamEndingWith(
  finishReason: FinishReason,
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      { index: 0, delta: { content: 'partial', role: 'assistant' }, finish_reason: finishReason, logprobs: null },
    ],
  };
  return {
    output: { role: 'assistant', content: 'partial' },
    usage: { input_tokens: 10, output_tokens: OUTPUT_TOKENS, total_tokens: 10 + OUTPUT_TOKENS },
    finish_reason: finishReason,
  };
}

async function runUntilDone({
  finishReason,
  modelParams,
}: {
  finishReason: FinishReason;
  modelParams: Record<string, unknown> | undefined;
}): Promise<InternalThreadDoneEvent> {
  const modelClient: ILLM = {
    create: jest.fn().mockImplementation(() => streamEndingWith(finishReason)),
    createNonStream: jest.fn(),
  };
  const thread = new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger: silentLogger,
    definition: {
      modelClient,
      modelName: TEST_MODEL_NAME,
      instruction: 'test',
      toolSets: [],
      ...(modelParams !== undefined ? { modelParams } : {}),
    },
    context: [{ role: 'user', content: 'hi' }],
  });
  for await (const event of thread.execute({ signal: new AbortController().signal })) {
    if (event.type === InternalEventType.AGENT_DONE) {
      return event;
    }
  }
  throw new Error('thread finished without a done event');
}

describe('AgentThread finish reason errors', () => {
  it.each<{
    name: string;
    finishReason: FinishReason;
    modelParams: Record<string, unknown> | undefined;
    error: string;
  }>([
    {
      name: 'length at the configured limit',
      finishReason: 'length',
      modelParams: { max_tokens: OUTPUT_TOKENS },
      error: 'Output truncated: hit the 4096 token limit. Raise max_tokens and retry.',
    },
    {
      name: 'length below a different configured limit',
      finishReason: 'length',
      modelParams: { max_tokens: 16000 },
      error: 'Output truncated: hit the 16000 token limit after 4096 tokens. Raise max_tokens and retry.',
    },
    {
      name: 'length with no configured limit',
      finishReason: 'length',
      modelParams: undefined,
      error: "Output truncated: hit the provider's default token limit after 4096 tokens. Raise max_tokens and retry.",
    },
    {
      name: 'content_filter',
      finishReason: 'content_filter',
      modelParams: undefined,
      error: "Output blocked: the model's content safety filter stopped the response. Rephrase the request and retry.",
    },
  ])('fails the turn for $name', async ({ finishReason, modelParams, error }) => {
    const done = await runUntilDone({ finishReason, modelParams });
    expect(done).toMatchObject({ status: 'error', error });
  });
});
