import { InvalidAgentSendInputError } from '../../src/core/errors';
import { EventType } from '../../src/core/events/schema';
import type { InternalEnrichedAssistantMessage } from '../../src/core/llm/LLMTypes';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import { InternalEventType } from '../../src/core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../core/harnessMocks';
import {
  llmCreateInputs,
  makeApprovalGatedWriteNoteToolSet,
  runTurn,
  textReplyStream,
  WRITE_NOTE_CALL_ID,
  writeNoteToolCallStream,
} from './helpers/helpers';

const ROOT_ID = 'thread_root';
const CHILD_ID = 'thread_child';
const SUB_AGENT_CALL_ID = 'call-sub';
const INSTRUCTION = 'You are running in a test setup.';
const STEER_REPLY = 'acknowledged the new instruction';
const CHILD_REPLY = 'child still running';

describe('orchestration: user message while work is pending', () => {
  it('rejects empty and incomplete action batches while approval is pending, then steers with a user message without executing the tool', async () => {
    const { orchestrator, thread, callTool } = makeApprovalHarness(STEER_REPLY);

    await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });
    expect(callTool).not.toHaveBeenCalled();

    await expect(runTurn({ orchestrator, sendBatch: [] })).rejects.toThrow(InvalidAgentSendInputError);
    await expect(
      runTurn({
        orchestrator,
        sendBatch: [
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: ROOT_ID,
            tool_call_id: 'unknown-call',
            approval: { status: 'allow' },
          },
        ],
      }),
    ).rejects.toThrow(/no pending approval/);

    const steered = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'never mind, do this instead' }],
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(steered.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: EventType.TOOL_RESPONSE,
          thread_id: ROOT_ID,
          tool_call_id: WRITE_NOTE_CALL_ID,
        }),
        expect.objectContaining({
          type: InternalEventType.AGENT_DONE,
          thread_id: ROOT_ID,
          status: 'done',
        }),
      ]),
    );
    expect(steered.result.required_actions).toEqual([]);
    expect(llmCreateInputs(thread.definition.modelClient).at(-1)).toMatchObject({
      messages: expect.arrayContaining([
        {
          role: 'tool',
          tool_call_id: WRITE_NOTE_CALL_ID,
          content: 'Tool call was cancelled: a new turn was started.',
        },
        { role: 'user', content: 'never mind, do this instead' },
      ]),
    });

    await expect(
      runTurn({
        orchestrator,
        sendBatch: [
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: ROOT_ID,
            tool_call_id: WRITE_NOTE_CALL_ID,
            approval: { status: 'allow' },
          },
        ],
      }),
    ).rejects.toThrow(/no pending approval/);
  });

  it('cancels an open sub-agent when a user message arrives', async () => {
    const { orchestrator, childCreate } = makeOpenSubAgentHarness();
    const steered = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'stop the worker' }],
    });
    expect(childCreate).not.toHaveBeenCalled();
    expect(steered.events[0]).toMatchObject({
      type: InternalEventType.AGENT_DONE,
      thread_id: CHILD_ID,
      status: 'cancelled',
    });
    expect(steered.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: EventType.TOOL_RESPONSE,
          thread_id: ROOT_ID,
          tool_call_id: SUB_AGENT_CALL_ID,
        }),
        expect.objectContaining({ type: InternalEventType.AGENT_DONE, thread_id: ROOT_ID, status: 'done' }),
      ]),
    );
  });

  it('resumes an open sub-agent on empty input', async () => {
    const { orchestrator, childCreate } = makeOpenSubAgentHarness();
    const resumed = await runTurn({ orchestrator, sendBatch: [] });
    expect(childCreate).toHaveBeenCalled();
    expect(resumed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: EventType.TOOL_RESPONSE,
          thread_id: ROOT_ID,
          tool_call_id: SUB_AGENT_CALL_ID,
        }),
        expect.objectContaining({ type: InternalEventType.AGENT_DONE, thread_id: CHILD_ID, status: 'done' }),
        expect.objectContaining({ type: InternalEventType.AGENT_DONE, thread_id: ROOT_ID, status: 'done' }),
      ]),
    );
    expect(resumed.events.some(e => e.type === InternalEventType.AGENT_DONE && e.status === 'cancelled')).toBe(false);
  });
});

function makeApprovalHarness(finalReply: string): {
  orchestrator: AgentThreadOrchestrator;
  thread: AgentThread;
  callTool: jest.Mock;
} {
  const { toolSet, callTool } = makeApprovalGatedWriteNoteToolSet();
  const thread = new AgentThread({
    definition: {
      modelClient: {
        create: jest
          .fn()
          .mockImplementationOnce(() => writeNoteToolCallStream())
          .mockImplementation(() => textReplyStream(finalReply)),
        createNonStream: jest.fn(),
      },
      instruction: INSTRUCTION,
      messages: undefined,
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: undefined,
    },
    threadId: ROOT_ID,
    title: 'orchestration-user-message',
    parent: undefined,
    agentInfo: undefined,
    context: undefined,
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: [
      {
        systemToolSets: [toolSet],
        preSendProcessors: undefined,
        preLLMProcessors: undefined,
        preLLMEphemeralProcessors: undefined,
        postToolCallProcessors: undefined,
        toolResponseProcessors: undefined,
        instructionBuilders: undefined,
      },
    ],
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
  return {
    orchestrator: new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    }),
    thread,
    callTool,
  };
}

function makeOpenSubAgentHarness(): { orchestrator: AgentThreadOrchestrator; childCreate: jest.Mock } {
  const assistant: InternalEnrichedAssistantMessage = {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: SUB_AGENT_CALL_ID,
        type: 'function',
        function: { name: 'create_sub_agent', arguments: '{"name":"worker","input":"task"}' },
        tool_info: {
          type: 'mcp',
          mcp_server_id: 'sub-agents',
          mcp_server_name: 'sub-agents',
          original_tool_name: 'create_sub_agent',
          is_thread_creation: true,
          is_approval_required: false,
          is_client_side: false,
        },
      },
    ],
  };
  const root = new AgentThread({
    definition: {
      modelClient: {
        create: jest.fn().mockImplementation(() => textReplyStream(STEER_REPLY)),
        createNonStream: jest.fn(),
      },
      instruction: INSTRUCTION,
      messages: undefined,
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: undefined,
    },
    threadId: ROOT_ID,
    title: 'main',
    parent: undefined,
    agentInfo: undefined,
    context: [assistant],
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: undefined,
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
  const childCreate = jest.fn().mockImplementation(() => textReplyStream(CHILD_REPLY));
  const child = new AgentThread({
    definition: {
      modelClient: {
        create: childCreate,
        createNonStream: jest.fn(),
      },
      instruction: undefined,
      messages: [{ role: 'user', content: 'task' }],
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: undefined,
    },
    threadId: CHILD_ID,
    title: 'worker',
    parent: { thread_id: ROOT_ID, tool_call_id: SUB_AGENT_CALL_ID },
    agentInfo: { type: 'dynamic', name: 'worker', input: 'task' },
    context: undefined,
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: undefined,
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
  return {
    orchestrator: new AgentThreadOrchestrator({
      agentThreads: new Map([
        [root.threadId, root],
        [child.threadId, child],
      ]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent spawn')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    }),
    childCreate,
  };
}
