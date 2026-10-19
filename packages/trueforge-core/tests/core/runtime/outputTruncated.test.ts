import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { InternalEventType, type InternalThreadDoneEvent } from '../../../src/core/runtime/AgentThread.types';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger, TEST_MODEL_NAME } from '../harnessMocks';

const silentLogger = makeSilentLogger();

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* truncatedStream(): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { content: 'partial', role: 'assistant' }, finish_reason: 'length', logprobs: null }],
  };
  return {
    output: { role: 'assistant', content: 'partial' },
    usage: { input_tokens: 10, output_tokens: 4096, total_tokens: 4106 },
    finish_reason: 'length',
  };
}

async function runUntilDone(modelParams: Record<string, unknown> | undefined): Promise<InternalThreadDoneEvent> {
  const modelClient: ILLM = {
    create: jest.fn().mockImplementation(() => truncatedStream()),
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

describe('AgentThread output truncation', () => {
  it('reports only the limit when output used all of it', async () => {
    const done = await runUntilDone({ max_tokens: 4096 });
    expect(done).toMatchObject({
      status: 'error',
      error: 'Output truncated: hit the 4096 token limit. Raise max_tokens and retry.',
    });
  });

  it('reports output tokens used when they differ from the configured limit', async () => {
    const done = await runUntilDone({ max_tokens: 16000 });
    expect(done).toMatchObject({
      status: 'error',
      error: 'Output truncated: hit the 16000 token limit after 4096 tokens. Raise max_tokens and retry.',
    });
  });

  it('omits the limit when none is configured', async () => {
    const done = await runUntilDone(undefined);
    expect(done).toMatchObject({
      status: 'error',
      error: 'Output truncated: hit the token limit after 4096 tokens. Raise max_tokens and retry.',
    });
  });
});
