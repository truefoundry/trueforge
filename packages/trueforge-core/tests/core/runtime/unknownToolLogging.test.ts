import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { makeUnknownToolInfo, toToolCallInfo } from '../../../src/core/runtime/contextUtils';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger } from '../harnessMocks';

const silentLogger = makeSilentLogger();
const warn = jest.spyOn(silentLogger, 'warn');

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* unknownToolStream(): AsyncGenerator<
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
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-unknown',
              type: 'function',
              function: { name: 'totally_unknown_tool', arguments: '{}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  return {
    output: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-unknown',
          type: 'function',
          function: { name: 'totally_unknown_tool', arguments: '{}' },
        },
      ],
    },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* finalAnswerStream(): AsyncGenerator<
  ExtendedChatCompletionChunk,
  RawAssistantMessageWithUsage,
  unknown
> {
  yield {
    id: 'chunk-2',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  };

  return {
    output: { role: 'assistant', content: 'done' },
    usage: getEmptyUsage(),
    finish_reason: 'stop',
  };
}

describe('AgentThread unknown tool logging', () => {
  it('warns once with the canonical message and emits unknown tool_info', async () => {
    const modelClient: ILLM = {
      create: jest
        .fn()
        .mockImplementationOnce(() => unknownToolStream())
        .mockImplementation(() => finalAnswerStream()),
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

    const deltas: { tool_calls?: { tool_info?: unknown }[] | undefined }[] = [];
    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      if (event.type === 'model.message.delta') {
        deltas.push(event);
      }
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('LLM called unknown tool: Tool totally_unknown_tool not found in tool mapping.');

    const unknownInfo = toToolCallInfo(makeUnknownToolInfo('totally_unknown_tool'));
    const emitted = deltas.flatMap(d => d.tool_calls ?? []).find(tc => tc.tool_info);
    expect(emitted?.tool_info).toEqual(unknownInfo);
  });
});
