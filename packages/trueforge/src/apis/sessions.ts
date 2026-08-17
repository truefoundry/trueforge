/**
 * DB-backed sessions API (mounted at /api/v1/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, SessionHandle, SessionRecord, Sessions } from '@truefoundry/trueforge-core/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  SessionStoreNotFoundError,
  TurnNotFoundError,
} from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import {
  redisRequest,
  RequestTimeoutError,
  type RouteHandler as RequestReplyRouteHandler,
  type RequestReplyRouter,
} from '@truefoundry/trueforge-core/request-reply';
import type { RedisClientType } from 'redis';
import { ulid } from 'ulid';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { ResolveUserContext } from '../auth/identity';
import configuration from '../config';
import type { IAgentStore } from '../db/agentStore';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import {
  cancelSessionRoute,
  createSessionRoute,
  deleteSessionRoute,
  getSessionRoute,
  listSessionEventsRoute,
  listSessionsRoute,
  updateSessionRoute,
} from '../routes/sessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { executorFromTurnId } from '../runtime/peeringIds';
import { validateAgentSpec } from '../runtime/sessionResources';
import { isSessionAgentNameRef, type Session } from '../schemas/session';

/** The server is single-tenant; every record lives under one fixed tenant scope. */
export const TENANT_ID = 'default';

/** Request-reply path a replica serves to cancel a turn it owns. */
export const SESSIONS_CANCEL_PATH = 'sessions/cancel';

/** Wire body of a peer cancel; validated on receipt (it crosses processes via Redis). */
const CancelPeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  reason: z.enum(CancellationReason),
});
type CancelPeerBody = z.infer<typeof CancelPeerBodySchema>;

export function toWireSession(record: SessionRecord): Session {
  return {
    id: record.session_id,
    agent: record.agent,
    title: record.title,
    created_by: record.created_by,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
  };
}

export interface SessionsRouterDeps {
  sessions: Sessions;
  sessionStore: ISessionStore;
  activeTurns: ActiveTurnRegistry;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  agentStore: IAgentStore;
  sandboxProviderStore: ISandboxProviderStore;
  redis?: RedisClientType | undefined;
  requestReplyRouter: RequestReplyRouter;
  resolveUserContext: ResolveUserContext;
  logger: Logger;
}

function cancelTurnOnThisExecutor(
  activeTurns: ActiveTurnRegistry,
  input: { sessionId: string; turnId: string; reason: CancellationReason },
): boolean {
  return activeTurns.cancelIfRunning({
    sessionId: input.sessionId,
    turnId: input.turnId,
    abortReason: input.reason,
  });
}

/**
 * Peer-facing cancel handler: aborts the turn if it runs in this process.
 * 200 = abort fired, 412 = not running here (treated by callers as a no-op).
 */
export function cancelSessionTurnPeerHandler(activeTurns: ActiveTurnRegistry): RequestReplyRouteHandler {
  // Synchronous by nature; the transport expects a Promise and require-await
  // forbids an async fn without awaits.
  return request => {
    const parsed = CancelPeerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return Promise.resolve({ status: 400, body: { message: 'Invalid sessions/cancel payload' } });
    }
    const found = cancelTurnOnThisExecutor(activeTurns, {
      sessionId: parsed.data.session_id,
      turnId: parsed.data.turn_id,
      reason: parsed.data.reason,
    });
    return Promise.resolve(
      found ? { status: 200, body: {} } : { status: 412, body: { message: 'Turn is not running on this executor' } },
    );
  };
}

/** A registry to abort in, a session to freeze, durable state to read, and a way to reach peers. */
export interface CancelTurnDeps {
  activeTurns: ActiveTurnRegistry;
  session: Pick<SessionHandle, 'session_id' | 'freezeTurn'>;
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClientType | undefined;
  logger: Pick<Logger, 'warn'>;
}

/**
 * Cancels the turn wherever it runs: locally or on the owning peer over Redis
 * request-reply. Callers state the motive; default is a plain client cancel.
 *
 * A confirmed abort (this process, or peer HTTP 200) lets TurnHandle persist
 * the terminal state. If abort cannot be confirmed, this replica freezes the
 * turn in the store so the session is not stuck `running`.
 *
 * Redis timeout and Redis/transport failures are not a clean cancellation —
 * the owning replica may still be executing — but the turn is still frozen.
 * Later writes from that replica lose to first-terminal-write-wins.
 */
export async function cancelSessionTurn(
  deps: CancelTurnDeps,
  input: { turnId: string; reason?: CancellationReason },
): Promise<void> {
  const { turnId, reason = CancellationReason.ClientCancelled } = input;
  const sessionId = deps.session.session_id;

  const turn = await deps.sessionStore.getTurn({
    session_id: sessionId,
    turn_id: turnId,
  });
  if (turn?.state.status !== 'running') {
    // Missing or already terminal — nothing to cancel.
    return;
  }

  const owner = executorFromTurnId(turnId);
  // Without a Redis client there is no peer to ask, so an id naming another
  // replica falls through to the local lookup and freezes if the run is gone.
  if (owner !== configuration.EXECUTOR_ID && deps.redis) {
    try {
      const reply = await redisRequest<CancelPeerBody>({
        redis: deps.redis,
        executorId: owner,
        path: SESSIONS_CANCEL_PATH,
        request: {
          body: { session_id: sessionId, turn_id: turnId, reason },
        },
        options: {
          replyTimeoutMs: configuration.REDIS_REQUEST_REPLY_TIMEOUT_MS,
          pollIntervalMs: configuration.REDIS_REQUEST_REPLY_POLL_INTERVAL_MS,
        },
      });
      if (reply.status === 200) {
        return;
      }
    } catch (error) {
      const fields = {
        sessionId,
        turnId,
        owner,
        ...extractErrorLogFields(error),
      };
      if (error instanceof RequestTimeoutError) {
        deps.logger.warn('Timed out waiting for owning executor to cancel; freezing the running turn', fields);
      } else {
        deps.logger.warn('Failed to reach owning executor over Redis; freezing the running turn', fields);
      }
    }
    await freezeTurnIgnoringMissing(deps.session, { turnId, reason });
    return;
  }

  const aborted = cancelTurnOnThisExecutor(deps.activeTurns, { sessionId, turnId, reason });
  if (!aborted) {
    await freezeTurnIgnoringMissing(deps.session, { turnId, reason });
  }
}

/** Freeze a running turn; missing turns are a no-op (already gone). */
async function freezeTurnIgnoringMissing(
  session: Pick<SessionHandle, 'freezeTurn'>,
  input: { turnId: string; reason: CancellationReason },
): Promise<void> {
  try {
    await session.freezeTurn({ turn_id: input.turnId, reason: input.reason });
  } catch (error) {
    if (error instanceof TurnNotFoundError) {
      return;
    }
    throw error;
  }
}

const FORBIDDEN_SESSION_ACCESS = 'Only the session creator can access this session';

function checkSessionAccess({ userRef, createdBy }: { userRef: string; createdBy: string }): boolean {
  return userRef === createdBy;
}

/** DB-backed sessions (mounted at /api/v1/sessions). */
export function createSessionsRouter(deps: SessionsRouterDeps) {
  const createSessionHandler: RouteHandler<typeof createSessionRoute> = async c => {
    const body = c.req.valid('json');
    const sessionId = ulid().toLowerCase();

    if (isSessionAgentNameRef(body.agent)) {
      const agent = await deps.agentStore.getAgent({ tenant_id: TENANT_ID, name: body.agent.name });
      if (agent === undefined) {
        return c.json({ error: { message: `Agent not found: ${body.agent.name}` } }, 404);
      }
      const user = deps.resolveUserContext(c);
      const session = await deps.sessions.create({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        created_by: user.userRef,
        agent: { type: 'reference', id: agent.id, name: agent.name },
      });
      return c.json({ data: toWireSession(session.record) }, 201);
    }

    await validateAgentSpec({
      spec: body.agent.spec,
      tenant_id: TENANT_ID,
      modelProviderStore: deps.modelProviderStore,
      mcpServerStore: deps.mcpServerStore,
      skillStore: deps.skillStore,
      sandboxProviderStore: deps.sandboxProviderStore,
    });
    const user = deps.resolveUserContext(c);
    const session = await deps.sessions.create({
      tenant_id: TENANT_ID,
      session_id: sessionId,
      created_by: user.userRef,
      agent: { type: 'inline', spec: body.agent.spec },
    });
    return c.json({ data: toWireSession(session.record) }, 201);
  };

  const getSessionHandler: RouteHandler<typeof getSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (!checkSessionAccess({ userRef: deps.resolveUserContext(c).userRef, createdBy: record.created_by })) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const deleteSessionHandler: RouteHandler<typeof deleteSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      // Idempotent delete when already gone.
      return c.body(null, 204);
    }
    if (!checkSessionAccess({ userRef: deps.resolveUserContext(c).userRef, createdBy: record.created_by })) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    await deps.sessionStore.deleteSession({ tenant_id: TENANT_ID, session_id: sessionId });
    return c.body(null, 204);
  };

  const updateSessionHandler: RouteHandler<typeof updateSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!existing) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (!checkSessionAccess({ userRef: deps.resolveUserContext(c).userRef, createdBy: existing.created_by })) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    // Inline sessions may replace their agent; named (reference) sessions
    // cannot — the store rejects that with SessionStoreInvariantError → 422 below.
    if (body.agent !== undefined) {
      await validateAgentSpec({
        spec: body.agent.spec,
        tenant_id: TENANT_ID,
        modelProviderStore: deps.modelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        sandboxProviderStore: deps.sandboxProviderStore,
      });
    }
    try {
      await deps.sessionStore.updateSession({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        agent: body.agent === undefined ? undefined : { type: 'inline', spec: body.agent.spec },
        title: undefined,
      });
    } catch (error) {
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
      }
      if (error instanceof SessionStoreInvariantError) {
        return c.json({ error: { message: error.message } }, 422);
      }
      throw error;
    }
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const listSessionsHandler: RouteHandler<typeof listSessionsRoute> = async c => {
    const query = c.req.valid('query');
    const user = deps.resolveUserContext(c);
    try {
      const { data, pagination } = await deps.sessionStore.listSessions({
        agent_id: query.agent_id,
        created_by: user.userRef,
        tenant_id: TENANT_ID,
        limit: query.limit,
        order: query.order,
        page_token: query.page_token,
        start_timestamp: query.start_timestamp,
        end_timestamp: query.end_timestamp,
      });
      return c.json({ data: data.map(toWireSession), pagination }, 200);
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const cancelSessionHandler: RouteHandler<typeof cancelSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (!checkSessionAccess({ userRef: deps.resolveUserContext(c).userRef, createdBy: session.record.created_by })) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const turnId = session.record.last_turn_id;
    if (!turnId) {
      return c.json({}, 200);
    }

    await cancelSessionTurn({ ...deps, session }, { turnId });
    return c.json({}, 200);
  };

  const listSessionEventsHandler: RouteHandler<typeof listSessionEventsRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (!checkSessionAccess({ userRef: deps.resolveUserContext(c).userRef, createdBy: session.record.created_by })) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    try {
      const { data, pagination } = await session.listEvents({
        limit: query.limit,
        page_token: query.page_token,
        last_turn_id: query.last_turn_id,
      });
      return c.json({ data, pagination }, 200);
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(createSessionRoute, createSessionHandler);
  router.openapi(getSessionRoute, getSessionHandler);
  router.openapi(deleteSessionRoute, deleteSessionHandler);
  router.openapi(updateSessionRoute, updateSessionHandler);
  router.openapi(listSessionsRoute, listSessionsHandler);
  router.openapi(cancelSessionRoute, cancelSessionHandler);
  router.openapi(listSessionEventsRoute, listSessionEventsHandler);
  deps.requestReplyRouter.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(deps.activeTurns));
  return router;
}
