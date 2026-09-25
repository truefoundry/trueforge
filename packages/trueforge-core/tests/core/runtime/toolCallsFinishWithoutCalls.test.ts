import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { InternalEventType, type AgentThreadEvent } from '../../../src/core/runtime/AgentThread.types';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger } from '../harnessMocks';

const silentLogger = makeSilentLogger();

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* toolCallsFinishWithoutCallsStream(): AsyncGenerator<
  ExtendedChatCompletionChunk,
  RawAssistantMessageWithUsage,
  unknown
> {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'calling a tool' }, finish_reason: 'tool_calls' }],
  };

  return {
    output: { role: 'assistant', content: 'calling a tool' },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

function collectDoneAndAppend(events: AgentThreadEvent[]) {
  return {
    done: events.filter(event => event.type === InternalEventType.AGENT_DONE),
    append: events.filter(event => event.type === InternalEventType.AGENT_CONTEXT_APPEND),
  };
}

describe('AgentThread tool_calls finish without tool_calls', () => {
  it('errors instead of marking the turn done when finish_reason is tool_calls but no tools were parsed', async () => {
    const modelClient: ILLM = {
      create: jest.fn().mockImplementation(() => toolCallsFinishWithoutCallsStream()),
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

    const events: AgentThreadEvent[] = [];
    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      events.push(event);
    }

    const { done } = collectDoneAndAppend(events);
    expect(done).toHaveLength(1);
    const terminal = done[0];
    if (!terminal) {
      throw new Error('expected AGENT_DONE');
    }
    expect(terminal).toMatchObject({
      type: InternalEventType.AGENT_DONE,
      status: 'error',
    });
    if (terminal.type === InternalEventType.AGENT_DONE && terminal.status === 'error') {
      expect(terminal.error).toContain('finish_reason is tool_calls');
      expect(terminal.error).toContain('no tool_calls');
    }
  });

  it('records a sub-agent error completion instead of done', async () => {
    const modelClient: ILLM = {
      create: jest.fn().mockImplementation(() => toolCallsFinishWithoutCallsStream()),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      threadId: 'child',
      title: 'Child',
      tracing: NOOP_AGENT_TRACING,
      logger: silentLogger,
      parent: { thread_id: 'main', tool_call_id: 'call-parent' },
      definition: {
        modelClient,
        instruction: 'test',
        toolSets: [],
      },
      context: [{ role: 'user', content: 'hi' }],
    });

    const events: AgentThreadEvent[] = [];
    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      events.push(event);
    }

    const { done, append } = collectDoneAndAppend(events);
    expect(append).toHaveLength(1);
    const appendEvent = append[0];
    if (!appendEvent) {
      throw new Error('expected AGENT_CONTEXT_APPEND');
    }
    if (appendEvent.type === InternalEventType.AGENT_CONTEXT_APPEND) {
      expect(appendEvent.completion).toMatchObject({
        type: 'error',
        send_to_parent: { role: 'tool', tool_call_id: 'call-parent' },
      });
      expect(appendEvent.completion?.type).not.toBe('done');
    }

    expect(done).toHaveLength(1);
    const terminal = done[0];
    if (!terminal) {
      throw new Error('expected AGENT_DONE');
    }
    expect(terminal).toMatchObject({
      type: InternalEventType.AGENT_DONE,
      status: 'error',
    });
    if (terminal.type === InternalEventType.AGENT_DONE && terminal.status === 'error') {
      expect(terminal.send_to_parent).toMatchObject({ role: 'tool', tool_call_id: 'call-parent' });
    }
  });
});
