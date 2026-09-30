/** Pause on write_note approval, then resume after allow or deny. */
import { EventType } from '../../src/core/events/schema';
import type { IToolSet, ToolSource } from '../../src/core/mcp/IMCPServer';
import { toolResultResponse } from '../../src/core/mcp/IMCPServer';
import { ToolSet } from '../../src/core/mcp/ToolSet';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import { InternalEventType, type AgentThreadConstructorInput } from '../../src/core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../core/harnessMocks';
import {
  llmCreateInputs,
  runTurn,
  textReplyStream,
  WRITE_NOTE_ARGUMENTS,
  WRITE_NOTE_CALL_ID,
  WRITE_NOTE_RESULT,
  WRITE_NOTE_TOOL_NAME,
  writeNoteToolCallStream,
} from './helpers/helpers';

/** notes MCP server exposing an approval-gated write_note tool. */
function makeWriteNoteSource(callTool: ToolSource['callTool']): ToolSource {
  return {
    name: 'notes',
    id: 'notes',
    listTools: () =>
      Promise.resolve({
        result: {
          tools: [
            {
              name: WRITE_NOTE_TOOL_NAME,
              description: 'Write a note',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
              preload: true,
            },
          ],
        },
        wasInitialized: undefined,
      }),
    callTool,
    toolCallInfo: () =>
      Promise.resolve({
        type: 'mcp',
        mcp_server_id: 'notes',
        mcp_server_name: 'notes',
        original_tool_name: WRITE_NOTE_TOOL_NAME,
      }),
  };
}

const GATED_WRITE_NOTE_SELECTORS = {
  enableTools: ['@all'],
  disableTools: [],
  preloadTools: [],
  requireApprovalForTools: [WRITE_NOTE_TOOL_NAME],
};

/** Approval-gated write_note tool set; `callTool` spy proves allow runs the source and deny does not. */
function makeApprovalGatedWriteNoteToolSet(): {
  toolSet: IToolSet;
  callTool: jest.Mock;
} {
  const callTool = jest.fn(() => Promise.resolve(toolResultResponse({ text: WRITE_NOTE_RESULT })));
  return {
    toolSet: new ToolSet({
      source: makeWriteNoteSource(callTool),
      selectors: GATED_WRITE_NOTE_SELECTORS,
      preload: true,
      approvalPolicies: undefined,
    }),
    callTool,
  };
}

const ROOT_ID = 'thread_root';
const DENY_REASON = 'not allowed in this test';
/** ToolSet deny → isError path wraps the text payload again for context. */
const DENY_TOOL_CONTENT = JSON.stringify({
  error: [{ type: 'text', text: JSON.stringify({ error: `User denied tool call: ${DENY_REASON}` }) }],
});
const INSTRUCTION = 'You are running in a test setup.';

const WRITE_NOTE_TOOLS = [{ function: { name: WRITE_NOTE_TOOL_NAME } }];

const EXPECTED_TURN_1_EVENTS = [
  { type: EventType.MODEL_MESSAGE, thread_id: ROOT_ID },
  { type: EventType.MODEL_MESSAGE_DELTA, thread_id: ROOT_ID },
  {
    type: InternalEventType.AGENT_CONTEXT_APPEND,
    thread_id: ROOT_ID,
    context: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: WRITE_NOTE_CALL_ID,
            type: 'function',
            function: { name: WRITE_NOTE_TOOL_NAME, arguments: WRITE_NOTE_ARGUMENTS },
          },
        ],
      },
    ],
  },
  {
    type: EventType.TOOL_APPROVAL_REQUIRED,
    thread_id: ROOT_ID,
    tool_calls: [{ id: WRITE_NOTE_CALL_ID }],
  },
];

const TURN_1_OUTPUT = {
  output: null,
  required_actions: [
    {
      type: EventType.TOOL_APPROVAL_REQUIRED,
      thread_id: ROOT_ID,
      tool_calls: [{ id: WRITE_NOTE_CALL_ID }],
    },
  ],
};

const EXPECTED_TURN_1_LLM_INPUT = [
  {
    tools: WRITE_NOTE_TOOLS,
    messages: [
      { role: 'system', content: expect.stringContaining(INSTRUCTION) },
      { role: 'user', content: 'hello' },
    ],
  },
];

describe('orchestration: pause then resume on tool approval', () => {
  describe('allow', () => {
    const ROOT_FINAL = 'note saved';

    const EXPECTED_TURN_2_EVENTS = [
      { type: EventType.TOOL_RESPONSE, thread_id: ROOT_ID, tool_call_id: WRITE_NOTE_CALL_ID },
      {
        type: InternalEventType.AGENT_CONTEXT_APPEND,
        thread_id: ROOT_ID,
        context: [{ role: 'tool', tool_call_id: WRITE_NOTE_CALL_ID, content: WRITE_NOTE_RESULT }],
      },
      { type: EventType.MODEL_MESSAGE, thread_id: ROOT_ID },
      { type: EventType.MODEL_MESSAGE_DELTA, thread_id: ROOT_ID, content: ROOT_FINAL },
      {
        type: InternalEventType.AGENT_CONTEXT_APPEND,
        thread_id: ROOT_ID,
        context: [{ role: 'assistant', content: ROOT_FINAL }],
      },
      { type: InternalEventType.AGENT_DONE, thread_id: ROOT_ID, status: 'done' },
    ];

    const TURN_2_OUTPUT = {
      output: { thread_id: ROOT_ID, content: ROOT_FINAL },
      required_actions: [],
    };

    const EXPECTED_TURN_2_INPUT = {
      tools: WRITE_NOTE_TOOLS,
      messages: [
        { role: 'system', content: expect.stringContaining(INSTRUCTION) },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: WRITE_NOTE_CALL_ID,
              type: 'function',
              function: { name: WRITE_NOTE_TOOL_NAME, arguments: WRITE_NOTE_ARGUMENTS },
            },
          ],
        },
        { role: 'tool', tool_call_id: WRITE_NOTE_CALL_ID, content: WRITE_NOTE_RESULT },
      ],
    };

    it('pauses for write_note approval, then finishes after allow', async () => {
      const { orchestrator, thread, callTool } = makeApprovalHarness(ROOT_FINAL);

      const paused = await runTurn({
        orchestrator,
        sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      });
      expect(paused.events).toMatchObject(EXPECTED_TURN_1_EVENTS);
      expect(paused.result).toMatchObject(TURN_1_OUTPUT);
      expect(paused.result.root_agent_error).toBeUndefined();
      expect(llmCreateInputs(thread.definition.modelClient)).toMatchObject(EXPECTED_TURN_1_LLM_INPUT);
      expect(callTool).not.toHaveBeenCalled();

      const resumed = await runTurn({
        orchestrator,
        sendBatch: [
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: ROOT_ID,
            tool_call_id: WRITE_NOTE_CALL_ID,
            approval: { status: 'allow' },
          },
        ],
      });
      expect(resumed.events).toMatchObject(EXPECTED_TURN_2_EVENTS);
      expect(resumed.result).toMatchObject(TURN_2_OUTPUT);
      expect(resumed.result.root_agent_error).toBeUndefined();
      expect(callTool).toHaveBeenCalledTimes(1);
      expect(llmCreateInputs(thread.definition.modelClient)).toMatchObject([
        ...EXPECTED_TURN_1_LLM_INPUT,
        EXPECTED_TURN_2_INPUT,
      ]);
    });
  });

  describe('deny', () => {
    const ROOT_FINAL = 'ok, I will not write the note';

    const EXPECTED_TURN_2_EVENTS = [
      { type: EventType.TOOL_RESPONSE, thread_id: ROOT_ID, tool_call_id: WRITE_NOTE_CALL_ID },
      {
        type: InternalEventType.AGENT_CONTEXT_APPEND,
        thread_id: ROOT_ID,
        context: [{ role: 'tool', tool_call_id: WRITE_NOTE_CALL_ID, content: DENY_TOOL_CONTENT }],
      },
      { type: EventType.MODEL_MESSAGE, thread_id: ROOT_ID },
      { type: EventType.MODEL_MESSAGE_DELTA, thread_id: ROOT_ID, content: ROOT_FINAL },
      {
        type: InternalEventType.AGENT_CONTEXT_APPEND,
        thread_id: ROOT_ID,
        context: [{ role: 'assistant', content: ROOT_FINAL }],
      },
      { type: InternalEventType.AGENT_DONE, thread_id: ROOT_ID, status: 'done' },
    ];

    const TURN_2_OUTPUT = {
      output: { thread_id: ROOT_ID, content: ROOT_FINAL },
      required_actions: [],
    };

    const EXPECTED_TURN_2_INPUT = {
      tools: WRITE_NOTE_TOOLS,
      messages: [
        { role: 'system', content: expect.stringContaining(INSTRUCTION) },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: WRITE_NOTE_CALL_ID,
              type: 'function',
              function: { name: WRITE_NOTE_TOOL_NAME, arguments: WRITE_NOTE_ARGUMENTS },
            },
          ],
        },
        { role: 'tool', tool_call_id: WRITE_NOTE_CALL_ID, content: DENY_TOOL_CONTENT },
      ],
    };

    it('pauses for write_note approval, then finishes after deny without running the tool', async () => {
      const { orchestrator, thread, callTool } = makeApprovalHarness(ROOT_FINAL);

      const paused = await runTurn({
        orchestrator,
        sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      });
      expect(paused.events).toMatchObject(EXPECTED_TURN_1_EVENTS);
      expect(paused.result).toMatchObject(TURN_1_OUTPUT);
      expect(callTool).not.toHaveBeenCalled();

      // Deny is a new turn (send + execute), same as allow — turn 1 already stopped at approval.
      const resumed = await runTurn({
        orchestrator,
        sendBatch: [
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: ROOT_ID,
            tool_call_id: WRITE_NOTE_CALL_ID,
            approval: { status: 'deny', reason: DENY_REASON },
          },
        ],
      });
      expect(resumed.events).toMatchObject(EXPECTED_TURN_2_EVENTS);
      expect(resumed.result).toMatchObject(TURN_2_OUTPUT);
      expect(resumed.result.root_agent_error).toBeUndefined();
      expect(callTool).not.toHaveBeenCalled();
      expect(llmCreateInputs(thread.definition.modelClient)).toMatchObject([
        ...EXPECTED_TURN_1_LLM_INPUT,
        EXPECTED_TURN_2_INPUT,
      ]);
    });
  });
});

const POLICY_SERVER_NAME = 'notes';

describe('AgentThreadOrchestrator.applyApprovalPolicies', () => {
  // The policy applies to user MCP servers (definition.toolSets), unlike the
  // approval-flow harness above which registers the tool set as a system tool set.
  let toolSet: IToolSet;
  let orchestrator: AgentThreadOrchestrator;

  beforeEach(() => {
    toolSet = makeApprovalGatedWriteNoteToolSet().toolSet;
    const thread = new AgentThread({
      definition: {
        modelClient: { create: jest.fn(), createNonStream: jest.fn() },
        instruction: INSTRUCTION,
        messages: undefined,
        modelParams: undefined,
        responseFormat: undefined,
        iterationLimit: undefined,
        toolSets: [toolSet],
      },
      threadId: ROOT_ID,
      title: 'orchestration-approval-policy',
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
    });
    orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent in policy test')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });
  });

  it('records a policy on the matching tool set for a known server', () => {
    const result = orchestrator.applyApprovalPolicies([
      { server_name: POLICY_SERVER_NAME, name: WRITE_NOTE_TOOL_NAME, action: { type: 'allow_session' } },
    ]);

    expect(result.errors).toEqual([]);
    expect(toolSet.getApprovalPolicies()).toEqual({
      [WRITE_NOTE_TOOL_NAME]: { type: 'allow_session' },
    });
  });

  it('carries expiry through onto the recorded policy', () => {
    const expire_at = '2099-01-01T00:00:00.000Z';

    orchestrator.applyApprovalPolicies([
      { server_name: POLICY_SERVER_NAME, name: WRITE_NOTE_TOOL_NAME, action: { type: 'allow_session', expire_at } },
    ]);

    expect(toolSet.getApprovalPolicies()).toEqual({
      [WRITE_NOTE_TOOL_NAME]: { type: 'allow_session', expire_at },
    });
  });

  it('rejects an unknown server name and applies nothing (fail-closed)', () => {
    const result = orchestrator.applyApprovalPolicies([
      { server_name: POLICY_SERVER_NAME, name: WRITE_NOTE_TOOL_NAME, action: { type: 'allow_session' } },
      { server_name: 'does-not-exist', name: 'whatever', action: { type: 'allow_session' } },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does-not-exist');
    // Nothing applied because validation failed for one item.
    expect(toolSet.getApprovalPolicies()).toEqual({});
  });

  it('last write wins for the same (server, tool)', () => {
    orchestrator.applyApprovalPolicies([
      { server_name: POLICY_SERVER_NAME, name: WRITE_NOTE_TOOL_NAME, action: { type: 'allow_session' } },
    ]);
    orchestrator.applyApprovalPolicies([
      {
        server_name: POLICY_SERVER_NAME,
        name: WRITE_NOTE_TOOL_NAME,
        action: { type: 'allow_session', expire_at: '2099-01-01T00:00:00.000Z' },
      },
    ]);

    expect(toolSet.getApprovalPolicies()).toEqual({
      [WRITE_NOTE_TOOL_NAME]: { type: 'allow_session', expire_at: '2099-01-01T00:00:00.000Z' },
    });
  });
});

describe('ToolSet: policy-aware is_approval_required', () => {
  const writeNoteParams = { name: WRITE_NOTE_TOOL_NAME, arguments: { text: 'hi' } };

  it('requires approval by default for a gated tool', async () => {
    const { toolSet } = makeApprovalGatedWriteNoteToolSet();
    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(true);
  });

  it('without an applicable policy, callTool returns approvalRequired and does not run the tool', async () => {
    const { toolSet, callTool } = makeApprovalGatedWriteNoteToolSet();
    const response = await toolSet.callTool(writeNoteParams);
    expect('approvalRequired' in response).toBe(true);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('an applicable policy auto-allows: no approval flag, callTool runs without a decision', async () => {
    const { toolSet, callTool } = makeApprovalGatedWriteNoteToolSet();
    toolSet.setApprovalPolicy(WRITE_NOTE_TOOL_NAME, { type: 'allow_session' });

    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(false);

    const response = await toolSet.callTool(writeNoteParams);
    expect('approvalRequired' in response).toBe(false);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('an unexpired policy auto-allows', async () => {
    const { toolSet } = makeApprovalGatedWriteNoteToolSet();
    toolSet.setApprovalPolicy(WRITE_NOTE_TOOL_NAME, {
      type: 'allow_session',
      expire_at: '2099-01-01T00:00:00.000Z',
    });
    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(false);
  });

  it('an expired policy still requires approval', async () => {
    const { toolSet } = makeApprovalGatedWriteNoteToolSet();
    toolSet.setApprovalPolicy(WRITE_NOTE_TOOL_NAME, {
      type: 'allow_session',
      expire_at: '2000-01-01T00:00:00.000Z',
    });
    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(true);
  });

  it('carries an applicable policy forward from the previous snapshot at construction', async () => {
    const toolSet = new ToolSet({
      source: makeWriteNoteSource(jest.fn()),
      selectors: GATED_WRITE_NOTE_SELECTORS,
      preload: true,
      approvalPolicies: { [WRITE_NOTE_TOOL_NAME]: { type: 'allow_session' } },
    });
    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(false);
  });

  it('drops already-expired policies carried forward from the snapshot', async () => {
    const toolSet = new ToolSet({
      source: makeWriteNoteSource(jest.fn()),
      selectors: GATED_WRITE_NOTE_SELECTORS,
      preload: true,
      approvalPolicies: { [WRITE_NOTE_TOOL_NAME]: { type: 'allow_session', expire_at: '2000-01-01T00:00:00.000Z' } },
    });
    // Pruned at seed, so it is neither exposed nor auto-allowing.
    expect(toolSet.getApprovalPolicies()).toEqual({});
    const info = await toolSet.toolCallInfo(writeNoteParams);
    expect(info.is_approval_required).toBe(true);
  });
});

function makeApprovalHarness(finalReply: string): {
  orchestrator: AgentThreadOrchestrator;
  thread: AgentThread;
  callTool: jest.Mock;
} {
  const { toolSet, callTool } = makeApprovalGatedWriteNoteToolSet();
  const agentThreadInput: AgentThreadConstructorInput = {
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
    title: 'orchestration-approval',
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
  };

  const thread = new AgentThread(agentThreadInput);
  const orchestrator = new AgentThreadOrchestrator({
    agentThreads: new Map([[thread.threadId, thread]]),
    createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent in approval test')),
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
  return { orchestrator, thread, callTool };
}
