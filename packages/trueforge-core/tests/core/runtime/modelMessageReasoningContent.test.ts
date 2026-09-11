import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { InternalEventType, type AgentThreadAppendContext } from '../../../src/core/runtime/AgentThread.types';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger } from '../harnessMocks';

const silentLogger = makeSilentLogger();

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* reasoningAnswerStream(): AsyncGenerator<
  ExtendedChatCompletionChunk,
  RawAssistantMessageWithUsage,
  unknown
> {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { reasoning_content: 'step one' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  };
  yield {
    id: 'chunk-2',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { content: 'hello', role: 'assistant' },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  };

  return {
    output: {
      role: 'assistant',
      content: 'hello',
      reasoning_content: 'step one',
      thinking_blocks: [{ type: 'thinking', thinking: 'step one' }],
    },
    usage: getEmptyUsage(),
    finish_reason: 'stop',
  };
}

describe('AgentThread model.message reasoning_content', () => {
  it('persists reasoning_content on the event and omits it from context', async () => {
    const modelClient: ILLM = {
      create: jest.fn().mockImplementation(() => reasoningAnswerStream()),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      threadId: 'main',
      title: 'Main',
      tracing: NOOP_AGENT_TRACING,
      logger: silentLogger,
      definition: {
        modelClient,
        instruction: 'test',
        toolSets: [],
      },
      context: [{ role: 'user', content: 'hi' }],
    });

    let append: AgentThreadAppendContext | undefined;
    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      if (event.type === InternalEventType.AGENT_CONTEXT_APPEND) {
        append = event;
      }
    }

    expect(append?.context[0]).not.toHaveProperty('reasoning_content');
    expect(append?.context[0]).toMatchObject({
      thinking_blocks: [{ type: 'thinking', thinking: 'step one' }],
    });

    const modelMessage = append?.output.find(e => e.type === 'model.message');
    expect(modelMessage).toMatchObject({ reasoning_content: 'step one' });
    expect(modelMessage).not.toHaveProperty('thinking_blocks');
  });
});
