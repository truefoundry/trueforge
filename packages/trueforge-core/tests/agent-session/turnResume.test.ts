/**
 * End-to-end same-turn resume tests at the agent-session level. Exercises the
 * TurnHandle.send → orchestrator resume seam the POST /events handler drives in production.
 */
import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import { EventType } from '../../src/agent-session/schemas/events';
import { CancellationReason } from '../../src/agent-session/schemas/turn';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import type { AgentCapability } from '../../src/core/capabilities/AgentCapability';
import { newEventId } from '../../src/core/events/schema';
import type { IToolSet, ListToolsResponse, ToolSource } from '../../src/core/mcp/IMCPServer';
import { toolResultResponse } from '../../src/core/mcp/IMCPServer';
import { ToolSet } from '../../src/core/mcp/ToolSet';
import { withTimeout } from '../../src/core/util/promiseUtils';
import {
  textReplyStream,
  WRITE_NOTE_CALL_ID,
  WRITE_NOTE_RESULT,
  WRITE_NOTE_TOOL_NAME,
  writeNoteToolCallStream,
} from '../orchestration/helpers/helpers';
import { makeAgentSpec, makeTestResolver, mintTestTurnId, TEST_ACTIVE_EXECUTOR_ID } from './testHelpers';

/** notes MCP source exposing an approval-gated write_note tool; `callTool` proves allow runs it. */
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

function makeApprovalGatedCapability(): { capability: AgentCapability; callTool: jest.Mock } {
  const callTool = jest.fn(() => Promise.resolve(toolResultResponse({ text: WRITE_NOTE_RESULT })));
  const toolSet: IToolSet = new ToolSet({
    source: makeWriteNoteSource(callTool),
    selectors: {
      enableTools: ['@all'],
      disableTools: [],
      preloadTools: [],
      requireApprovalForTools: [WRITE_NOTE_TOOL_NAME],
    },
    preload: true,
    approvalPolicies: undefined,
  });
  return { capability: { systemToolSets: [toolSet] }, callTool };
}

function makeAuthCapability() {
  let authorized = false;
  const listTools = jest.fn((): Promise<ListToolsResponse> => {
    if (!authorized) {
      return Promise.resolve({
        authRequired: {
          servers: [{ id: 'oauth-server', name: 'oauth-server', auth_url: 'https://auth.example' }],
        },
      });
    }
    return Promise.resolve({ result: { tools: [] }, wasInitialized: undefined });
  });
  const toolSet: IToolSet = {
    id: 'oauth-server',
    name: 'oauth-server',
    preload: true,
    hasPreloadedTools: true,
    listTools,
    callTool: jest.fn(),
    toolCallInfo: jest.fn(),
    setApprovalPolicy: jest.fn(),
    getApprovalPolicies: jest.fn(() => ({})),
    hasApplicableApprovalPolicy: jest.fn(() => false),
  };
  return {
    capability: { systemToolSets: [toolSet] } satisfies AgentCapability,
    authorize: () => {
      authorized = true;
    },
    listTools,
  };
}

describe('TurnHandle.send() full-approval resume (agent-session e2e)', () => {
  const ROOT_FINAL = 'note saved';

  async function createSession() {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    return { store, session };
  }

  it('pauses the live stream on tool approval, then send(allow) resumes it to done', async () => {
    const { store, session } = await createSession();
    const { capability, callTool } = makeApprovalGatedCapability();
    // First LLM call emits the gated write_note tool call; the follow-up call (after the tool
    // response) returns the final assistant text.
    const llmCreate = jest
      .fn()
      .mockImplementationOnce(() => writeNoteToolCallStream())
      .mockImplementation(() => textReplyStream(ROOT_FINAL));
    const controller = new AbortController();

    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: controller.signal,
      resolver: makeTestResolver({ extraCapabilities: [capability], llmCreate }),
    });
    expect(turn.state.status).toBe('running');

    // Drive the live stream exactly as the wiring layer would: when it parks on the approval
    // (turn.update paused), inject the approval decision via TurnHandle.send(), which wakes the
    // SAME execution, then keep draining to terminal done.
    const types: string[] = [];
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    let paused = false;
    let sent = false;
    const iterator = turn.stream(controller);
    let step = await iterator.next();
    while (!step.done) {
      const event = step.value as { type: string; state?: { status: string }; [k: string]: unknown };
      types.push(event.type);
      events.push(event);
      if (event.type === EventType.TURN_UPDATE && event.state?.status === 'paused') {
        paused = true;
        // The gated tool has NOT run while we are parked awaiting the decision.
        expect(callTool).not.toHaveBeenCalled();
        expect(sent).toBe(false);
        await turn.send([
          {
            type: EventType.USER_TOOL_APPROVAL,
            id: newEventId(),
            created_at: new Date().toISOString(),
            thread_id: MAIN_THREAD_ID,
            tool_call_id: WRITE_NOTE_CALL_ID,
            approval: { status: 'allow' },
          },
        ]);
        sent = true;
      }
      step = await iterator.next();
    }

    // The stream paused once and resumed to a terminal done.
    expect(paused).toBe(true);
    expect(sent).toBe(true);
    expect(types[0]).toBe(EventType.TURN_CREATED);
    expect(types[types.length - 1]).toBe(EventType.TURN_DONE);

    // Approval-required was surfaced before the pause; the tool response + final model message
    // came out after the resume; the tool ran exactly once (allow).
    const approvalRequired = events.find(e => e.type === EventType.TOOL_APPROVAL_REQUIRED);
    expect(approvalRequired).toMatchObject({ tool_calls: [{ id: WRITE_NOTE_CALL_ID }] });
    expect(events.some(e => e.type === EventType.TOOL_RESPONSE && e['tool_call_id'] === WRITE_NOTE_CALL_ID)).toBe(true);
    expect(events.some(e => e.type === EventType.MODEL_MESSAGE)).toBe(true);
    // Deltas pass through the stream (never persisted); the final reply text rides the delta.
    expect(events.some(e => e.type === EventType.MODEL_MESSAGE_DELTA && e['content'] === ROOT_FINAL)).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(1);

    // Terminal state is durably committed.
    expect(turn.state.status).toBe('done');
    const stored = await store.getTurn({ session_id: 's1', turn_id: turn.id });
    expect(stored?.state.status).toBe('done');
  });

  it('abandon while parked at approval wakes execution and persists client cancellation', async () => {
    const { store, session } = await createSession();
    const { capability } = makeApprovalGatedCapability();
    const controller = new AbortController();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: controller.signal,
      resolver: makeTestResolver({
        extraCapabilities: [capability],
        llmCreate: jest.fn().mockImplementation(() => writeNoteToolCallStream()),
      }),
    });

    const iterator = turn.stream(controller);
    let step = await iterator.next();
    while (!step.done && !(step.value.type === EventType.TURN_UPDATE && step.value.state.status === 'paused')) {
      step = await iterator.next();
    }
    expect(step.done).toBe(false);

    // Park execute() on wakeSignal.wait(), then abandon without aborting the caller's controller.
    const pendingNext = iterator.next();
    const close = iterator.return(undefined);
    try {
      await withTimeout(Promise.all([pendingNext, close]), 1_000, 'paused stream abandonment');
    } finally {
      // Releases the old broken implementation too, so a failed regression test cannot hang Jest.
      if (!controller.signal.aborted) {
        controller.abort(CancellationReason.ClientCancelled);
      }
    }

    expect(turn.state).toMatchObject({
      status: 'cancelled',
      reason: CancellationReason.ClientCancelled,
    });
    const stored = await store.getTurn({ session_id: 's1', turn_id: turn.id });
    expect(stored?.state).toMatchObject({
      status: 'cancelled',
      reason: CancellationReason.ClientCancelled,
    });
  });
});

describe('TurnHandle.send() MCP-auth continuation', () => {
  it('persists the wait, resumes the same turn, and retries preloaded-tool initialization', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const { capability, authorize, listTools } = makeAuthCapability();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        extraCapabilities: [capability],
        llmCreate: jest.fn(() => textReplyStream('authorized')),
      }),
    });

    const eventTypes: string[] = [];
    const iterator = turn.stream();
    let sentContinue = false;
    const next = () =>
      withTimeout(iterator.next(), 1_000, `next after ${eventTypes.join(',')}; sentContinue=${String(sentContinue)}`);
    let step = await next();
    while (!step.done) {
      eventTypes.push(step.value.type);
      if (step.value.type === EventType.MCP_AUTH_REQUIRED) {
        const stored = await store.getTurn({ session_id: 's1', turn_id: turn.id });
        expect(stored?.snapshot.threads[MAIN_THREAD_ID]?.pending_mcp_auth).toBe(true);
      }
      if (!sentContinue && step.value.type === EventType.TURN_UPDATE && step.value.state.status === 'paused') {
        authorize();
        const sends = await Promise.allSettled([
          turn.send([
            {
              type: EventType.USER_MCP_AUTH_CONTINUE,
              id: newEventId(),
              created_at: new Date().toISOString(),
            },
          ]),
          turn.send([
            {
              type: EventType.USER_MCP_AUTH_CONTINUE,
              id: newEventId(),
              created_at: new Date().toISOString(),
            },
          ]),
        ]);
        expect(sends.every(result => result.status === 'fulfilled')).toBe(true);
        sentContinue = true;
      }
      if (step.value.type === EventType.USER_MCP_AUTH_CONTINUE) {
        const stored = await store.getTurn({ session_id: 's1', turn_id: turn.id });
        expect(stored?.snapshot.threads[MAIN_THREAD_ID]?.pending_mcp_auth).toBe(false);
      }
      step = await next();
    }

    expect(sentContinue).toBe(true);
    expect(listTools).toHaveBeenCalledTimes(2);
    expect(eventTypes).toContain(EventType.MCP_AUTH_REQUIRED);
    expect(eventTypes.filter(type => type === EventType.USER_MCP_AUTH_CONTINUE)).toHaveLength(2);
    expect(eventTypes[eventTypes.length - 1]).toBe(EventType.TURN_DONE);
    expect(turn.state.status).toBe('done');
  });

  it('queues continue without inspecting thread blocking state', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });

    await expect(
      turn.send([
        {
          type: EventType.USER_MCP_AUTH_CONTINUE,
          id: newEventId(),
          created_at: new Date().toISOString(),
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
