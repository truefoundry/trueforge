import { OpenAPIHono } from '@hono/zod-openapi';
import {
  AgentSpecSchema,
  CancellationReason,
  Sessions,
  type TurnRecord,
} from '@truefoundry/trueforge-core/agent-session';
import {
  NO_RESPONDER_HEARTBEAT_LOST_DETAIL,
  NoResponderError,
  redisRequest,
  RequestReplyRouter,
  RequestTimeoutError,
} from '@truefoundry/trueforge-core/request-reply';
import type { Kysely } from 'kysely';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createEmptyAgentThreadMetrics } from '../../../../trueforge-core/src/core/runtime/metrics';
import {
  makeCancelledTurnState,
  makeCreateTurnInput,
  makePausedTurnState,
  makeTurnDoneEvent,
  makeTurnUpdateEvent,
  TEST_ACTIVE_EXECUTOR_ID,
} from '../../../../trueforge-core/tests/agent-session/testHelpers';
import { createTurnsRouter } from '../../../src/apis/turns';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import configuration from '../../../src/config';
import { EmptyCapabilitiesStore } from '../../../src/db/capabilitiesStore';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAccessControlStore } from '../../../src/db/sqlite/access-control-store/SqliteAccessControlStore';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import type { Database } from '../../../src/db/sqlite/types';
import { SqliteWebSearchProviderStore } from '../../../src/db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';

jest.mock('@truefoundry/trueforge-core/request-reply', () => {
  const actual = jest.requireActual<typeof import('@truefoundry/trueforge-core/request-reply')>(
    '@truefoundry/trueforge-core/request-reply',
  );
  return { ...actual, redisRequest: jest.fn() };
});

const redisRequestMock = jest.mocked(redisRequest);

const SESSION_ID = 's1';
const TURN_ID = 'turn-1';
/** The replica that owns the row until someone steals it. */
const OWNER = TEST_ACTIVE_EXECUTOR_ID;
const NEW_OWNER = 'replica-new';
const THIRD_OWNER = 'replica-third';
const SEND_EVENTS_PATH = 'turns/send-events';

type ClaimInput = Parameters<SqliteSessionStore['claimTurnExecutor']>[0];

/** Lets a test run another replica's write right before this replica's claim lands. */
class RacingSessionStore extends SqliteSessionStore {
  beforeClaim: (() => Promise<void>) | undefined;

  override async claimTurnExecutor(input: ClaimInput): Promise<boolean> {
    await this.beforeClaim?.();
    return super.claimTurnExecutor(input);
  }
}

interface Harness {
  app: OpenAPIHono;
  sessionStore: RacingSessionStore;
  requestReplyRouter: RequestReplyRouter;
  executorOf: () => Promise<string | undefined>;
  turnOf: () => Promise<TurnRecord | undefined>;
  /** Another replica claiming the paused row. */
  moveOwner: (input: { from: string; to: string }) => Promise<void>;
  cancelTurn: () => Promise<void>;
}

function turnExecutionStores(db: Kysely<Database>) {
  return {
    agentStore: new SqliteAgentStore(db),
    capabilitiesStore: new EmptyCapabilitiesStore(),
    modelProviderStore: new SqliteModelProviderStore(db),
    mcpServerStore: new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      clientName: 'test-client',
    }),
    skillStore: new SqliteSkillStore(db),
    sandboxProviderStore: new SqliteSandboxProviderStore(db),
    webSearchProviderStore: new SqliteWebSearchProviderStore(db),
    memory: undefined,
  };
}

async function createHarness(initial: { executorId: string; state: 'paused' | 'running' }): Promise<Harness> {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sessionStore = new RacingSessionStore(db);
  await sessionStore.createSession({
    tenant_id: 'default',
    session_id: SESSION_ID,
    created_by_subject: {
      subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
      subject_type: STANDALONE_REQUEST_CONTEXT.subject.type,
      subject_display_name: STANDALONE_REQUEST_CONTEXT.subject.display_name,
    },
    agent: {
      type: 'inline',
      spec: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
    },
    custom: null,
    metadata: {},
    external_id: null,
    source: null,
  });
  await sessionStore.createTurn(
    makeCreateTurnInput({ sessionId: SESSION_ID, turnId: TURN_ID, activeExecutorId: initial.executorId }),
  );
  const sessions = new Sessions({ sessionStore });
  const requestReplyRouter = new RequestReplyRouter();
  const app = new OpenAPIHono();
  app.route(
    '/',
    createTurnsRouter({
      accessControlStore: new SqliteAccessControlStore(db),
      activeTurns: new ActiveTurnRegistry({ logger: createLogger({ silent: true }) }),
      authorizer: new TrueForgeAuthorizer(),
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      logger: createLogger({ silent: true }),
      // Never connected: redisRequest is mocked, and the router only needs a client to be present.
      redis: createClient(),
      requestReplyRouter,
      resolveAgentStore: () => new SqliteAgentStore(db),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
      resolveTurnExecutionStores: () => Promise.resolve(turnExecutionStores(db)),
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      sessions,
      sessionStore,
    }),
  );

  const turnOf = () => sessions.get({ tenant_id: 'default', session_id: SESSION_ID }).then(s => s?.getTurn(TURN_ID));
  const cancelTurn = async () => {
    await sessionStore.freezeAndGetTurn({
      session_id: SESSION_ID,
      turn_id: TURN_ID,
      reason: CancellationReason.ClientCancelled,
      turn_done_event: makeTurnDoneEvent(makeCancelledTurnState(CancellationReason.ClientCancelled)),
    });
  };
  if (initial.state === 'paused') {
    const paused = makePausedTurnState();
    await sessionStore.updateTurnNonTerminalState({
      active_executor_id: initial.executorId,
      session_id: SESSION_ID,
      turn_id: TURN_ID,
      state: paused,
      turn_update_event: makeTurnUpdateEvent(paused),
      turn_metrics: {
        status: 'paused',
        observed_at: new Date().toISOString(),
        metrics: createEmptyAgentThreadMetrics(),
      },
    });
  }
  return {
    app,
    sessionStore,
    requestReplyRouter,
    turnOf,
    executorOf: () => turnOf().then(turn => turn?.active_executor_id),
    moveOwner: async ({ from, to }) => {
      const won = await new SqliteSessionStore(db).claimTurnExecutor({
        session_id: SESSION_ID,
        turn_id: TURN_ID,
        expected_executor_id: from,
        new_executor_id: to,
      });
      expect(won).toBe(true);
    },
    cancelTurn,
  };
}

async function postEvents(app: OpenAPIHono): Promise<Response> {
  return await app.request(`/${SESSION_ID}/turns/${TURN_ID}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer secret',
      cookie: 'session=1',
      'x-tfg-tools': '[]',
    },
    body: JSON.stringify({
      events: [
        {
          type: 'user.tool_approval',
          thread_id: 'main',
          tool_call_id: 'call-1',
          approval: { status: 'allow' },
        },
      ],
    }),
  });
}

function peerAccepted(): Awaited<ReturnType<typeof redisRequest>> {
  return { status: 200, body: { events: [] } };
}

function requestedExecutors(): string[] {
  return redisRequestMock.mock.calls.map(([request]) => request.executorId);
}

describe('POST /events across replicas', () => {
  beforeEach(() => {
    redisRequestMock.mockReset();
  });

  describe('owner is another replica', () => {
    it('forwards the batch to the owner, scoped to turn headers, and leaves ownership alone', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockResolvedValue(peerAccepted());

      const response = await postEvents(h.app);

      expect(response.status).toBe(201);
      expect(redisRequestMock).toHaveBeenCalledTimes(1);
      const [request] = redisRequestMock.mock.calls[0] ?? [];
      expect(request?.executorId).toBe(OWNER);
      expect(request?.path).toBe(SEND_EVENTS_PATH);
      expect(request?.request.body).toMatchObject({
        tenant_id: 'default',
        session_id: SESSION_ID,
        turn_id: TURN_ID,
        request_headers: { 'x-tfg-tools': '[]' },
      });
      expect(JSON.stringify(request?.request.body)).not.toContain('Bearer secret');
      await expect(h.executorOf()).resolves.toBe(OWNER);
    });

    it.each([
      [400, 400],
      [409, 409],
      [500, 500],
    ])('surfaces a peer %i reply as %i without stealing', async (peerStatus, expected) => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockResolvedValue({ status: peerStatus, body: { message: 'peer says no' } });

      const response = await postEvents(h.app);

      expect(response.status).toBe(expected);
      expect(redisRequestMock).toHaveBeenCalledTimes(1);
      await expect(h.executorOf()).resolves.toBe(OWNER);
    });

    it('sends to the new owner when the peer says it no longer owns the row', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockImplementationOnce(async () => {
        await h.moveOwner({ from: OWNER, to: NEW_OWNER });
        return { status: 412, body: { message: 'Turn is no longer owned by this executor' } };
      });
      redisRequestMock.mockResolvedValueOnce(peerAccepted());

      const response = await postEvents(h.app);

      expect(response.status).toBe(201);
      expect(requestedExecutors()).toEqual([OWNER, NEW_OWNER]);
      await expect(h.executorOf()).resolves.toBe(NEW_OWNER);
    });

    it('gives up with 500 when the owner keeps changing', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      const owners = [OWNER, NEW_OWNER, THIRD_OWNER, 'replica-fourth'];
      let hop = 0;
      redisRequestMock.mockImplementation(async () => {
        const from = owners[hop];
        const to = owners[hop + 1];
        hop += 1;
        if (from !== undefined && to !== undefined) {
          await h.moveOwner({ from, to });
        }
        return { status: 412, body: { message: 'Turn is no longer owned by this executor' } };
      });

      const response = await postEvents(h.app);

      expect(response.status).toBe(500);
      expect(redisRequestMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('owner never received the batch', () => {
    it('steals a paused turn whose owner has no responder', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockRejectedValue(new NoResponderError(OWNER));

      await postEvents(h.app);

      // Rebuilding the turn needs a real model, so only the claim itself is asserted here.
      expect(redisRequestMock).toHaveBeenCalledTimes(1);
      await expect(h.executorOf()).resolves.toBe(configuration.EXECUTOR_ID);
    });

    it('does not steal a turn that is still running under the missing owner', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'running' });
      redisRequestMock.mockRejectedValue(new NoResponderError(OWNER));

      const response = await postEvents(h.app);

      expect(response.status).toBe(409);
      await expect(h.executorOf()).resolves.toBe(OWNER);
    });

    it('does not apply a batch to a turn that finished while forwarding', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockImplementation(async () => {
        await h.cancelTurn();
        throw new NoResponderError(OWNER);
      });

      const response = await postEvents(h.app);

      expect(response.status).toBe(409);
      await expect(h.executorOf()).resolves.toBe(OWNER);
    });

    it('forwards to the new owner instead of stealing when the row moved meanwhile', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockImplementationOnce(async () => {
        await h.moveOwner({ from: OWNER, to: NEW_OWNER });
        throw new NoResponderError(OWNER);
      });
      redisRequestMock.mockResolvedValueOnce(peerAccepted());

      const response = await postEvents(h.app);

      expect(response.status).toBe(201);
      expect(requestedExecutors()).toEqual([OWNER, NEW_OWNER]);
      await expect(h.executorOf()).resolves.toBe(NEW_OWNER);
    });

    it('retries against the winner when another replica steals first', async () => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockRejectedValueOnce(new NoResponderError(OWNER));
      redisRequestMock.mockResolvedValueOnce(peerAccepted());
      h.sessionStore.beforeClaim = async () => {
        h.sessionStore.beforeClaim = undefined;
        await h.moveOwner({ from: OWNER, to: THIRD_OWNER });
      };

      const response = await postEvents(h.app);

      expect(response.status).toBe(201);
      expect(requestedExecutors()).toEqual([OWNER, THIRD_OWNER]);
      await expect(h.executorOf()).resolves.toBe(THIRD_OWNER);
    });
  });

  describe('owner may already have applied the batch', () => {
    it.each([
      ['reply timeout', () => new RequestTimeoutError(60_000)],
      ['heartbeat lost after publish', () => new NoResponderError(OWNER, NO_RESPONDER_HEARTBEAT_LOST_DETAIL)],
      ['transport failure', () => new Error('Redis connection closed')],
    ])('does not resend or steal after a %s', async (_name, makeError) => {
      const h = await createHarness({ executorId: OWNER, state: 'paused' });
      redisRequestMock.mockRejectedValue(makeError());

      const response = await postEvents(h.app);

      expect(response.status).toBe(500);
      expect(redisRequestMock).toHaveBeenCalledTimes(1);
      await expect(h.executorOf()).resolves.toBe(OWNER);
    });
  });

  describe('owner is this replica', () => {
    it('rejects a running turn that has no live generator here instead of forwarding', async () => {
      const h = await createHarness({ executorId: configuration.EXECUTOR_ID, state: 'running' });

      const response = await postEvents(h.app);

      expect(response.status).toBe(409);
      expect(redisRequestMock).not.toHaveBeenCalled();
    });
  });
});

describe('turns/send-events peer route', () => {
  beforeEach(() => {
    redisRequestMock.mockReset();
  });

  function peerRequest(h: Harness, overrides: Record<string, unknown> = {}) {
    return h.requestReplyRouter.dispatchRoute(SEND_EVENTS_PATH, {
      body: {
        tenant_id: 'default',
        session_id: SESSION_ID,
        turn_id: TURN_ID,
        events: [
          {
            id: '01J0000000000000000000000A',
            created_at: new Date().toISOString(),
            type: 'user.tool_approval',
            thread_id: 'main',
            tool_call_id: 'call-1',
            approval: { status: 'allow' },
          },
        ],
        request_context: {
          tenant_id: 'default',
          subject: { id: 'u', type: 'user', display_name: 'u' },
          roles: [],
          user_credential: null,
        },
        ...overrides,
      },
    });
  }

  it('answers 412 and does not steal when the row belongs to another replica', async () => {
    const h = await createHarness({ executorId: OWNER, state: 'paused' });

    const reply = await peerRequest(h);

    expect(reply.status).toBe(412);
    await expect(h.executorOf()).resolves.toBe(OWNER);
  });

  it('answers 409 for a running turn this replica owns but is not executing', async () => {
    const h = await createHarness({ executorId: configuration.EXECUTOR_ID, state: 'running' });

    const reply = await peerRequest(h);

    expect(reply.status).toBe(409);
  });

  it('answers 404 for an unknown session and 400 for a malformed payload', async () => {
    const h = await createHarness({ executorId: OWNER, state: 'paused' });

    await expect(peerRequest(h, { session_id: 'missing' })).resolves.toMatchObject({ status: 404 });
    await expect(peerRequest(h, { events: 'nope' })).resolves.toMatchObject({ status: 400 });
  });
});
