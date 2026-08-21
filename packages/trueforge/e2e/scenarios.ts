/**
 * Sequential E2E scenarios. Each proves one v1 flow against the compose stack.
 */
import { type TrueForge, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import {
  MCP_DEEPWIKI,
  MCP_LINEAR,
  NAMED_AGENT,
  SessionTracker,
  approveToolCall,
  baseAgentSpec,
  collectTurn,
  createClient,
  createInlineSession,
  createNamedAgentSession,
  denyToolCall,
  httpStatusCode,
  makeNonce,
  requireAction,
  textFileContent,
  userMessage,
  type TestCase,
} from './helpers';

async function runMemoryRecall({
  client,
  session,
  label,
}: {
  client: TrueForge;
  session: TrueForgeApi.Session;
  label: string;
}): Promise<void> {
  const nonce = makeNonce('SESSION');
  const tracker = new SessionTracker(session.id);

  const turn1 = await collectTurn({
    client,
    sessionId: session.id,
    input: [userMessage(`Remember this exact code for later: ${nonce}. Reply with just "ok".`)],
  });
  const turn1Id = tracker.record(turn1, { label: `${label} turn1` });

  const turn2 = await collectTurn({
    client,
    sessionId: session.id,
    input: [userMessage('What exact code did I ask you to remember? Reply with only the code.')],
    previousTurnId: turn1Id,
  });
  tracker.record(turn2, { label: `${label} turn2` });

  if (!turn2.finalText.includes(nonce)) {
    throw new Error(
      `turn 2 did not recall the nonce from turn 1 context.\nexpected to contain: ${nonce}\ngot: ${turn2.finalText}`,
    );
  }
}

/** Inline agent: a later turn recalls a nonce stored in session context. */
const sessionMemoryTest: TestCase = {
  name: 'session_memory',
  run: async () => {
    const client = createClient();
    const session = await createInlineSession({
      client,
      spec: baseAgentSpec({
        instructions: 'You are a terse assistant. Follow instructions exactly and keep replies short.',
      }),
    });
    await runMemoryRecall({ client, session, label: 'session_memory' });
  },
};

/** Named agent (`e2e-memory`): same recall check on a catalog agent, not an inline spec. */
const namedAgentMemoryTest: TestCase = {
  name: 'named_agent_memory',
  run: async () => {
    const client = createClient();
    const session = await createNamedAgentSession({ client, name: NAMED_AGENT });
    await runMemoryRecall({ client, session, label: 'named_agent_memory' });
  },
};

/** Preloaded Linear DCR MCP: connecting surfaces `mcp.auth_required` with a non-empty auth URL. */
const mcpAuthRequiredTest: TestCase = {
  name: 'mcp_auth_required',
  run: async () => {
    const client = createClient();
    const session = await createInlineSession({
      client,
      spec: baseAgentSpec({
        instructions: 'You have access to an MCP server. Keep replies short.',
        mcpServers: [{ name: MCP_LINEAR, preload: true }],
      }),
    });
    const tracker = new SessionTracker(session.id);
    const turn = await collectTurn({
      client,
      sessionId: session.id,
      input: [userMessage('List the tools available from your MCP server.')],
    });
    tracker.record(turn, {
      label: 'mcp_auth_required',
      expectRequiredAction: { type: 'mcp.auth_required', mcpServers: [{ name: MCP_LINEAR }] },
    });

    const auth = requireAction({ turn, type: 'mcp.auth_required', label: 'mcp_auth_required' });
    const server = auth.mcpServers.find(s => s.name === MCP_LINEAR) ?? auth.mcpServers[0];
    if (server === undefined || server.authUrl.trim() === '') {
      throw new Error(
        `mcp.auth_required did not include an authUrl for ${MCP_LINEAR}. servers: ${JSON.stringify(auth.mcpServers)}`,
      );
    }
  },
};

/** Pending `ask_user_question`: a follow-up user message without an answer is rejected with HTTP 422. */
const unresolvedRequiredActionTest: TestCase = {
  name: 'unresolved_required_action',
  run: async () => {
    const client = createClient();
    const session = await createInlineSession({
      client,
      spec: baseAgentSpec({
        instructions:
          'Before doing anything, you MUST gather required details from the user by calling the ask_user_question ' +
          'tool. Never guess or assume the answer. Keep replies short.',
        config: { askUserQuestions: { enabled: true } },
      }),
    });
    const tracker = new SessionTracker(session.id);
    const turn1 = await collectTurn({
      client,
      sessionId: session.id,
      input: [
        userMessage(
          'Book me a meeting room for tomorrow. First use the ask_user_question tool to ask which office building ' +
            'I want the room in — do not proceed until I answer.',
        ),
      ],
    });
    const turn1Id = tracker.record(turn1, {
      label: 'unresolved turn1',
      expectRequiredAction: { type: 'tool.response_required' },
    });

    let thrown: unknown;
    try {
      await collectTurn({
        client,
        sessionId: session.id,
        input: [userMessage('Actually, never mind the question — just book any room.')],
        previousTurnId: turn1Id,
      });
    } catch (error) {
      thrown = error;
    }
    if (thrown === undefined) {
      throw new Error('expected turn 2 to be rejected for leaving the pending question unresolved, but it succeeded');
    }
    const statusCode = httpStatusCode(thrown);
    if (statusCode !== 422) {
      throw new Error(
        `expected turn 2 to be rejected with HTTP 422 (unprocessable send while a question is pending), ` +
          `but got ${statusCode === undefined ? 'a non-HTTP failure' : `HTTP ${String(statusCode)}`}`,
        { cause: thrown },
      );
    }
  },
};

/** Cancel as soon as `turn.created` is seen, without blocking the SSE read, then both stream and `getTurn` are `cancelled`. */
const turnCancellationTest: TestCase = {
  name: 'turn_cancellation',
  run: async () => {
    const client = createClient();
    const session = await createInlineSession({
      client,
      spec: baseAgentSpec({
        instructions: 'You are a verbose assistant. When asked for a long answer, keep going and never stop early.',
      }),
    });

    const stream = await client.sessions.createTurnStream(session.id, {
      input: [
        userMessage(
          'Write an extremely long, exhaustive essay of at least 3000 words about the full history of computing. ' +
            'Do not summarize and do not stop early.',
        ),
      ],
    });

    const events: TrueForgeApi.TurnStreamingEvent[] = [];
    let cancelInFlight: Promise<unknown> | undefined;
    for await (const event of stream) {
      events.push(event);
      if (cancelInFlight === undefined && event.type === 'turn.created') {
        // Do not await here: blocking the SSE consumer lets a fast turn finish as `done` before cancel is applied.
        cancelInFlight = client.sessions.cancel(session.id);
      }
    }
    if (cancelInFlight === undefined) {
      throw new Error('streamed turn.created is missing; cancel was never requested.');
    }
    await cancelInFlight;

    const terminal = events.at(-1);
    if (terminal?.type !== 'turn.done') {
      throw new Error(`expected the stream to end with turn.done, got ${terminal?.type ?? '(no events)'}.`);
    }
    if (terminal.state.status !== 'cancelled') {
      throw new Error(`expected the streamed turn.done state to be "cancelled", got "${terminal.state.status}".`);
    }

    const created = events.find(event => event.type === 'turn.created');
    if (created === undefined) {
      throw new Error('streamed turn.created is missing; cannot verify cancel via getTurn.');
    }
    const listed = await client.sessions.getTurn(session.id, created.turnId);
    if (listed.data.state.status !== 'cancelled') {
      throw new Error(`getTurn reports turn ${created.turnId} as "${listed.data.state.status}", expected "cancelled".`);
    }
  },
};

const SUBAGENT_INSTRUCTIONS =
  'When asked to look something up, you MUST delegate the work to a sub-agent via the create_sub_agent ' +
  'tool rather than calling the tool yourself. The sub-agent must make exactly one tool call. Keep replies short.';

const SUBAGENT_TASK =
  'Create a sub-agent and instruct it to call ONLY the deepwiki `ask_question` tool exactly once, ' +
  'with repoName "facebook/react" and question "What is this repository about?". ' +
  'It must not call any other tool.';

async function startApprovalFlow(scenario: string) {
  const client = createClient();
  const session = await createInlineSession({
    client,
    spec: baseAgentSpec({
      instructions: SUBAGENT_INSTRUCTIONS,
      config: { dynamicSubAgents: { enabled: true } },
      mcpServers: [{ name: MCP_DEEPWIKI, requireApprovalForTools: ['@all'] }],
    }),
  });
  const tracker = new SessionTracker(session.id);
  const turn1 = await collectTurn({
    client,
    sessionId: session.id,
    input: [userMessage(SUBAGENT_TASK)],
  });
  const turn1Id = tracker.record(turn1, {
    label: `${scenario} turn1`,
    expectRequiredAction: { type: 'tool.approval_required' },
    allowMultipleThreads: true,
  });
  const approval = requireAction({ turn: turn1, type: 'tool.approval_required', label: `${scenario} turn1` });
  const toolCall = approval.toolCalls[0];
  if (toolCall === undefined) {
    throw new Error('tool.approval_required action carried no tool calls');
  }
  return { client, session, tracker, turn1Id, threadId: approval.threadId, toolCallId: toolCall.id };
}

/** Sub-agent MCP tool with `@all` approval: allowing the call runs the tool and finishes the thread. */
const subagentToolApprovalAllowTest: TestCase = {
  name: 'subagent_tool_approval_allow',
  run: async () => {
    const { client, session, tracker, turn1Id, threadId, toolCallId } = await startApprovalFlow('approve');
    const turn2 = await collectTurn({
      client,
      sessionId: session.id,
      input: [approveToolCall({ threadId, toolCallId })],
      previousTurnId: turn1Id,
    });
    tracker.record(turn2, { label: 'approve turn2', allowMultipleThreads: true });
    const executed = turn2.events.some(e => e.type === 'tool.response' && e.toolCallId === toolCallId);
    if (!executed) {
      throw new Error(`approved tool call ${toolCallId} did not execute in turn 2 (no matching tool.response event).`);
    }
    if (!turn2.events.some(e => e.type === 'thread.done')) {
      throw new Error(
        'expected the sub-agent thread to complete (thread.done) in turn 2 after approval, none observed.',
      );
    }
    tracker.assertAllThreadsClosed('approve');
  },
};

/** Same approval pause: denying the call returns a denial `tool.response` and still closes the thread. */
const subagentToolApprovalDenyTest: TestCase = {
  name: 'subagent_tool_approval_deny',
  run: async () => {
    const { client, session, tracker, turn1Id, threadId, toolCallId } = await startApprovalFlow('deny');
    const turn2 = await collectTurn({
      client,
      sessionId: session.id,
      input: [denyToolCall({ threadId, toolCallId, reason: 'denied by e2e test' })],
      previousTurnId: turn1Id,
    });
    tracker.record(turn2, { label: 'deny turn2', allowMultipleThreads: true });
    const response = turn2.events.find(e => e.type === 'tool.response' && e.toolCallId === toolCallId);
    if (response?.type !== 'tool.response') {
      throw new Error(`denied tool call ${toolCallId} produced no tool.response in turn 2.`);
    }
    if (!response.content.includes('denied')) {
      throw new Error(`expected a denial tool.response for ${toolCallId}, got content: ${response.content}`);
    }
    if (!turn2.events.some(e => e.type === 'thread.done')) {
      throw new Error('expected the sub-agent thread to complete (thread.done) in turn 2 after denial, none observed.');
    }
    tracker.assertAllThreadsClosed('deny');
  },
};

const UPLOAD_NAME = 'upload.txt';
const UPLOAD_MARKER = 'Distinctive marker line: MAGENTA-OTTER-7731-CANYON-BELL';

/** Uploaded sandbox file is unread on turn 1, then read on turn 2 from the same sandbox (not a new one). */
const sandboxPersistenceTest: TestCase = {
  name: 'sandbox_persistence',
  run: async () => {
    const client = createClient();
    const session = await createInlineSession({
      client,
      spec: baseAgentSpec({
        instructions: 'You have a code sandbox. Use it to read files exactly as asked. Keep replies short.',
        config: { sandbox: { enabled: true } },
      }),
    });
    const tracker = new SessionTracker(session.id);
    const turn1 = await collectTurn({
      client,
      sessionId: session.id,
      input: [
        userMessage([
          {
            type: 'text',
            text:
              `A text file named ${UPLOAD_NAME} has been uploaded to your sandbox. ` +
              `DO NOT READ IT NOW. YOU MUST REPLY WITH JUST OK.`,
          },
          textFileContent({
            name: UPLOAD_NAME,
            text: `Agent-harness sandbox upload fixture.\n${UPLOAD_MARKER}\n`,
          }),
        ]),
      ],
    });
    const turn1Id = tracker.record(turn1, { label: 'sandbox turn1', expectSandbox: true });
    const turn2 = await collectTurn({
      client,
      sessionId: session.id,
      input: [
        userMessage(
          `Print the exact contents of the ${UPLOAD_NAME} file that was uploaded to you earlier. Output it verbatim.`,
        ),
      ],
      previousTurnId: turn1Id,
    });
    tracker.record(turn2, { label: 'sandbox turn2' });
    if (turn2.sandboxIds.length > 0) {
      throw new Error(
        `expected turn 2 to reuse the persisted sandbox, but it provisioned a new one: ${turn2.sandboxIds.join(', ')}`,
      );
    }
    if (!turn2.finalText.includes(UPLOAD_MARKER)) {
      throw new Error(
        `turn 2 did not read the uploaded file back from the persisted sandbox.\nexpected to contain: ${UPLOAD_MARKER}\ngot: ${turn2.finalText}`,
      );
    }
  },
};

export const tests: TestCase[] = [
  sessionMemoryTest,
  mcpAuthRequiredTest,
  unresolvedRequiredActionTest,
  turnCancellationTest,
  subagentToolApprovalAllowTest,
  subagentToolApprovalDenyTest,
  sandboxPersistenceTest,
  namedAgentMemoryTest,
];
