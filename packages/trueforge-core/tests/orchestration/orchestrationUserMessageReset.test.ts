import { InvalidAgentSendInputError } from '../../src/core/errors';
import { EventType } from '../../src/core/events/schema';
import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall } from '../../src/core/llm/LLMTypes';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import type { AgentThreadConstructorInput, ContextMessage } from '../../src/core/runtime/AgentThread.types';
import { InternalEventType } from '../../src/core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../core/harnessMocks';
import { llmCreateInputs, runExecute, textReplyStream } from './helpers/helpers';

const MAIN_ID = 'main';
const CHILD_ID = 'child';
const TOOL_CALL_ID = 'call-sub';
const CANCELED = 'Canceled because user sent a new message.';
const INSTRUCTION = 'You are running in a test setup.';
const ROOT_REPLY = 'ack new message';
const FINISHED_CHILD_ANSWER = 'already finished work';

function threadCreationToolCall(id: string): InternalEnrichedToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'create_sub_agent', arguments: '{}' },
    tool_info: {
      type: 'truefoundry-system',
      mcp_server_id: '',
      mcp_server_name: '',
      original_tool_name: 'create_sub_agent',
      is_thread_creation: true,
    },
  };
}

function approvalToolCall(id: string): InternalEnrichedToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'needs_approval', arguments: '{}' },
    tool_info: {
      type: 'mcp',
      mcp_server_id: 'test-server',
      mcp_server_name: 'test-server',
      original_tool_name: 'needs_approval',
      is_approval_required: true,
    },
  };
}

function assistantWithCalls(toolCalls: InternalEnrichedToolCall[]): InternalEnrichedAssistantMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: toolCalls,
  };
}

function baseThreadInput(
  overrides: Partial<AgentThreadConstructorInput> & Pick<AgentThreadConstructorInput, 'threadId' | 'title'>,
): AgentThreadConstructorInput {
  return {
    definition: {
      modelClient: {
        create: jest.fn().mockImplementation(() => textReplyStream(ROOT_REPLY)),
        createNonStream: jest.fn().mockImplementation(() => textReplyStream(ROOT_REPLY)),
      },
      instruction: INSTRUCTION,
      messages: undefined,
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: undefined,
    },
    parent: undefined,
    agentInfo: undefined,
    context: undefined,
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: undefined,
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
    ...overrides,
  };
}

describe('orchestration: user-message reset', () => {
  it('cancels in-flight children, closes open tools on main, then sends the user message', async () => {
    const mainContext: ContextMessage[] = [
      assistantWithCalls([threadCreationToolCall(TOOL_CALL_ID), approvalToolCall('call-hitl')]),
    ];
    const main = new AgentThread(
      baseThreadInput({
        threadId: MAIN_ID,
        title: 'main',
        context: mainContext,
      }),
    );
    const child = new AgentThread(
      baseThreadInput({
        threadId: CHILD_ID,
        title: 'worker',
        parent: { thread_id: MAIN_ID, tool_call_id: TOOL_CALL_ID },
        agentInfo: { type: 'dynamic', name: 'worker', input: 'task' },
        definition: {
          modelClient: {
            create: jest.fn().mockImplementation(() => {
              throw new Error('cancelled child must not call the model');
            }),
            createNonStream: jest.fn(),
          },
          instruction: undefined,
          messages: undefined,
          modelParams: undefined,
          responseFormat: undefined,
          iterationLimit: undefined,
          toolSets: undefined,
        },
      }),
    );

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([
        [main.threadId, main],
        [child.threadId, child],
      ]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const sendEvents = [];
    for await (const event of orchestrator.send([{ type: EventType.USER_MESSAGE, content: 'new topic' }])) {
      sendEvents.push(event);
    }

    const { events, result } = await runExecute({ orchestrator });

    expect(child.toSnapshot().completion).toEqual(expect.objectContaining({ type: 'cancelled', reason: CANCELED }));
    expect(sendEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: InternalEventType.AGENT_CONTEXT_APPEND,
          thread_id: CHILD_ID,
          completion: expect.objectContaining({ type: 'cancelled', reason: CANCELED }),
        }),
        expect.objectContaining({
          type: InternalEventType.AGENT_CONTEXT_APPEND,
          thread_id: MAIN_ID,
          context: expect.arrayContaining([
            { role: 'tool', tool_call_id: TOOL_CALL_ID, content: CANCELED },
            { role: 'tool', tool_call_id: 'call-hitl', content: CANCELED },
          ]),
        }),
        expect.objectContaining({
          type: InternalEventType.AGENT_CONTEXT_APPEND,
          thread_id: MAIN_ID,
          context: [{ role: 'user', content: 'new topic' }],
        }),
      ]),
    );
    expect(events.filter(e => e.type === EventType.TOOL_RESPONSE)).toEqual([]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: InternalEventType.AGENT_DONE,
          thread_id: CHILD_ID,
          status: 'cancelled',
          reason: CANCELED,
        }),
      ]),
    );
    expect(result.output?.content).toBe(ROOT_REPLY);
    expect(llmCreateInputs(main.definition.modelClient)).toHaveLength(1);
  });

  it('delivers a finished child send_to_parent instead of the cancel string', async () => {
    const main = new AgentThread(
      baseThreadInput({
        threadId: MAIN_ID,
        title: 'main',
        context: [assistantWithCalls([threadCreationToolCall(TOOL_CALL_ID)])],
      }),
    );
    const child = new AgentThread(
      baseThreadInput({
        threadId: CHILD_ID,
        title: 'worker',
        parent: { thread_id: MAIN_ID, tool_call_id: TOOL_CALL_ID },
        agentInfo: { type: 'dynamic', name: 'worker', input: 'task' },
        preComputedCompletion: {
          type: 'done',
          output: {
            type: EventType.MODEL_MESSAGE,
            id: 'child-out',
            created_at: new Date().toISOString(),
            thread_id: CHILD_ID,
            content: FINISHED_CHILD_ANSWER,
            finish_reason: 'stop',
          },
          send_to_parent: {
            role: 'tool',
            tool_call_id: TOOL_CALL_ID,
            content: FINISHED_CHILD_ANSWER,
          },
        },
      }),
    );

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([
        [main.threadId, main],
        [child.threadId, child],
      ]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const sendEvents: unknown[] = [];
    for await (const event of orchestrator.send([{ type: EventType.USER_MESSAGE, content: 'new topic' }])) {
      sendEvents.push(event);
    }

    expect(sendEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: InternalEventType.AGENT_CONTEXT_APPEND,
          thread_id: MAIN_ID,
          context: [{ role: 'tool', tool_call_id: TOOL_CALL_ID, content: FINISHED_CHILD_ANSWER }],
        }),
        expect.objectContaining({
          type: InternalEventType.AGENT_CONTEXT_APPEND,
          thread_id: MAIN_ID,
          context: [{ role: 'user', content: 'new topic' }],
        }),
      ]),
    );
    expect(JSON.stringify(sendEvents)).not.toContain(CANCELED);

    const { events } = await runExecute({ orchestrator });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: InternalEventType.AGENT_DONE,
          thread_id: CHILD_ID,
          status: 'done',
        }),
      ]),
    );
  });

  it('throws when send() is called on a thread with preComputedCompletion', async () => {
    const child = new AgentThread(
      baseThreadInput({
        threadId: CHILD_ID,
        title: 'worker',
        parent: { thread_id: MAIN_ID, tool_call_id: TOOL_CALL_ID },
        preComputedCompletion: {
          type: 'cancelled',
          reason: CANCELED,
          send_to_parent: { role: 'tool', tool_call_id: TOOL_CALL_ID, content: CANCELED },
        },
      }),
    );
    await expect(child.send([]).next()).rejects.toBeInstanceOf(InvalidAgentSendInputError);
    expect(() => child.validateSendInput([])).toThrow(InvalidAgentSendInputError);
  });
});
