import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { AgentSpec, ISessionStore, SessionRecord, Sessions } from '@truefoundry/utils/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
} from '@truefoundry/utils/agent-session';
import type { RouteHandler as RequestReplyRouteHandler, RequestReplyRouter } from '@truefoundry/utils/request-reply';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/utils/request-reply';
import { HTTPException } from 'hono/http-exception';
import type { RedisClientType } from 'redis';
import { ulid } from 'ulid';
import { z } from 'zod';
import configuration from '../config';
import {
  cancelSessionRoute,
  createSessionRoute,
  getSessionRoute,
  listSessionEventsRoute,
  listSessionsRoute,
  updateSessionRoute,
} from '../routes/sessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { executorFromTurnId } from '../runtime/peeringIds';
import type { Session } from '../schemas/session';
import type { McpStore } from '../store/McpStore';
import type { ModelStore } from '../store/ModelStore';

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

/**
 * Cross-checks an AgentSpec against the YAML catalogs and the server's
 * capabilities before a session is created or updated, so misconfigured specs
 * fail at admission instead of at turn time. Returns undefined when the spec
 * is usable; otherwise an error with the status to respond with: 400 when the
 * spec references unknown catalog entries (a client-side spec problem), 422
 * when the spec is valid but this deployment cannot satisfy it (missing
 * sandbox provider).
 */
function validateAgentSpec(
  spec: AgentSpec,
  deps: { modelStore: ModelStore; mcpStore: McpStore; sandboxSupported: boolean },
): { status: 400 | 422; message: string } | undefined {
  const model = deps.modelStore.get(spec.model.name);
  if (!model) {
    return { status: 400, message: `Unknown model "${spec.model.name}" — not declared in models.yaml` };
  }
  const reasoningEffort = spec.model.params?.reasoning_effort;
  if (reasoningEffort !== undefined && !model.reasoning_efforts?.includes(reasoningEffort)) {
    return {
      status: 400,
      message: model.reasoning_efforts
        ? `Reasoning effort "${reasoningEffort}" is not supported by model "${model.name}"`
        : `Model "${model.name}" does not support configurable reasoning effort`,
    };
  }
  for (const server of spec.mcp_servers ?? []) {
    if (!deps.mcpStore.get(server.name)) {
      return { status: 400, message: `Unknown MCP server "${server.name}" — not declared in mcp.yaml` };
    }
  }
  const wantsSandbox = spec.config?.sandbox?.enabled === true;
  const hasSkills = (spec.skills?.length ?? 0) > 0;
  if ((wantsSandbox || hasSkills) && !deps.sandboxSupported) {
    return {
      status: 422,
      message: hasSkills
        ? 'skills require a sandbox provider — set SANDBOX_SETTINGS (and SANDBOX_API_KEY)'
        : 'sandbox is enabled in the agent spec but this server has no sandbox provider configured — set SANDBOX_SETTINGS (and SANDBOX_API_KEY)',
    };
  }
  return undefined;
}

export interface SessionsRouterDeps {
  sessions: Sessions;
  sessionStore: ISessionStore;
  activeTurns: ActiveTurnRegistry;
  modelStore: ModelStore;
  mcpStore: McpStore;
  /** Whether a sandbox provider is configured (SANDBOX_SETTINGS); gates spec admission. */
  sandboxSupported: boolean;
  /** Reaches peer executors; undefined in single-binary mode. */
  redis?: RedisClientType | undefined;
  /** Request-reply dispatch table this replica serves; cancel registers here. */
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
 * Peer-facing cancel handler (registered in createSessionsRouter): aborts the
 * turn if it runs in this process. 200 = abort fired, 412 = not running here
 * (treated by callers as a no-op).
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

export function createSessionsRouter(deps: SessionsRouterDeps) {
  const createSessionHandler: RouteHandler<typeof createSessionRoute> = async c => {
    const body = c.req.valid('json');
    const specError = validateAgentSpec(body.agent_spec, deps);
    if (specError) {
      // Hono's typed responses require a literal status per call site.
      return specError.status === 422
        ? c.json({ error: { message: specError.message } }, 422)
        : c.json({ error: { message: specError.message } }, 400);
    }
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

  const updateSessionHandler: RouteHandler<typeof updateSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.agent_spec) {
      const specError = validateAgentSpec(body.agent_spec, deps);
      if (specError) {
        return specError.status === 422
          ? c.json({ error: { message: specError.message } }, 422)
          : c.json({ error: { message: specError.message } }, 400);
      }
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

  // Cancels only the session's tail (last_turn_id). Cancelling with no
  // running turn is a 200 no-op, matching the turn state machine (first
  // terminal write wins).
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
  router.openapi(updateSessionRoute, updateSessionHandler);
  router.openapi(listSessionsRoute, listSessionsHandler);
  router.openapi(cancelSessionRoute, cancelSessionHandler);
  deps.requestReplyRouter.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(deps.activeTurns));
  router.openapi(listSessionEventsRoute, listSessionEventsHandler);
  return router;
}
