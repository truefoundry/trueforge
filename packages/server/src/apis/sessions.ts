/**
 * DB-backed sessions API (mounted at /api/v1/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, SessionRecord, Sessions } from '@truefoundry/utils-core/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
} from '@truefoundry/utils-core/agent-session';
import type {
  RouteHandler as RequestReplyRouteHandler,
  RequestReplyRouter,
} from '@truefoundry/utils-core/request-reply';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/utils-core/request-reply';
import { HTTPException } from 'hono/http-exception';
import type { RedisClientType } from 'redis';
import { ulid } from 'ulid';
import { z } from 'zod';
import configuration from '../config';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
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
import { validateAgentSpecDb } from '../runtime/dbSessionResources';
import { executorFromTurnId } from '../runtime/peeringIds';
import type { Session } from '../schemas/session';

/** The server is single-tenant; every record lives under one fixed tenant scope. */
export const TENANT_ID = 'default';

/** Request-reply path a replica serves to cancel a turn it owns. */
export const SESSIONS_CANCEL_PATH = 'sessions/cancel';

/** Wire body of a peer cancel; validated on receipt (it crosses processes via Redis). */
const CancelPeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  reason: z.nativeEnum(CancellationReason),
});
type CancelPeerBody = z.infer<typeof CancelPeerBodySchema>;

export function toWireSession(record: SessionRecord): Session {
  return {
    id: record.session_id,
    agent_spec: record.agent_spec,
    title: record.title,
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
  sandboxSupported: boolean;
  redis?: RedisClientType | undefined;
  requestReplyRouter: RequestReplyRouter;
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

/** A registry to abort in, durable state to read, and a way to reach peers. */
export interface CancelTurnDeps {
  activeTurns: ActiveTurnRegistry;
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClientType | undefined;
}

/**
 * Cancels the turn wherever it runs: locally or on the owning peer over Redis
 * request-reply. Callers state the motive; default is a plain client cancel.
 * Owner failures throw HTTPException (412 unreachable, 424 timed out).
 */
export async function cancelSessionTurn(
  deps: CancelTurnDeps,
  input: { sessionId: string; turnId: string; reason?: CancellationReason },
): Promise<void> {
  const { sessionId, turnId, reason = CancellationReason.ClientCancelled } = input;

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
  // replica falls through to the local lookup and finds nothing.
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
      if (reply.status !== 200 && reply.status !== 412) {
        throw new HTTPException(500, { message: 'Failed to cancel turn on the owning executor', cause: reply });
      }
    } catch (error) {
      if (error instanceof NoResponderError) {
        throw new HTTPException(412, {
          message: `Executor owning the running turn is unreachable: ${owner}`,
          cause: error,
        });
      }
      if (error instanceof RequestTimeoutError) {
        throw new HTTPException(424, {
          message: 'Timed out waiting for the owning executor to cancel the turn',
          cause: error,
        });
      }
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(500, {
        message: `Unexpected error while cancelling the turn on the owning executor: ${owner}`,
        cause: error,
      });
    }
    return;
  }

  cancelTurnOnThisExecutor(deps.activeTurns, { sessionId, turnId, reason });
}

/** DB-backed sessions (mounted at /api/v1/sessions). */
export function createSessionsRouter(deps: SessionsRouterDeps) {
  const createSessionHandler: RouteHandler<typeof createSessionRoute> = async c => {
    const body = c.req.valid('json');
    await validateAgentSpecDb({
      spec: body.agent_spec,
      tenant_id: TENANT_ID,
      modelProviderStore: deps.modelProviderStore,
      mcpServerStore: deps.mcpServerStore,
      skillStore: deps.skillStore,
      sandboxSupported: deps.sandboxSupported,
    });
    const session = await deps.sessions.create({
      tenant_id: TENANT_ID,
      session_id: ulid().toLowerCase(),
      agent_spec: body.agent_spec,
    });
    return c.json({ data: toWireSession(session.record) }, 201);
  };

  const getSessionHandler: RouteHandler<typeof getSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const deleteSessionHandler: RouteHandler<typeof deleteSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    await deps.sessionStore.deleteSession({ tenant_id: TENANT_ID, session_id: sessionId });
    return c.body(null, 204);
  };

  const updateSessionHandler: RouteHandler<typeof updateSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.agent_spec) {
      await validateAgentSpecDb({
        spec: body.agent_spec,
        tenant_id: TENANT_ID,
        modelProviderStore: deps.modelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        sandboxSupported: deps.sandboxSupported,
      });
    }
    try {
      await deps.sessionStore.updateSession({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        agent_spec: body.agent_spec,
        title: undefined,
      });
    } catch (error) {
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
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
    try {
      const { data, pagination } = await deps.sessionStore.listSessions({
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
    const { sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const turnId = record.last_turn_id;
    if (!turnId) {
      return c.json({}, 200);
    }

    await cancelSessionTurn(deps, { sessionId, turnId });
    return c.json({}, 200);
  };

  const listSessionEventsHandler: RouteHandler<typeof listSessionEventsRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
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
