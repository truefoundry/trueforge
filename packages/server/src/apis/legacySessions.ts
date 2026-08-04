/**
 * YAML-backed sessions API (mounted at /api/v1/legacy/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, LegacyAgentSpec, Sessions } from '@truefoundry/utils/agent-session';
import { SessionStoreConflictError, SessionStoreNotFoundError } from '@truefoundry/utils/agent-session';
import type { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import type { RedisClientType } from 'redis';
import { ulid } from 'ulid';
import type { McpStore } from '../legacy-registry-store/McpStore';
import type { ModelStore } from '../legacy-registry-store/ModelStore';
import {
  legacyCancelSessionRoute,
  legacyCreateSessionRoute,
  legacyDeleteSessionRoute,
  legacyGetSessionRoute,
  legacyListSessionEventsRoute,
  legacyListSessionsRoute,
  legacyUpdateSessionRoute,
} from '../routes/legacySessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import {
  cancelSessionTurn,
  cancelSessionTurnPeerHandler,
  SESSIONS_CANCEL_PATH,
  TENANT_ID,
  toWireSession,
} from './sessions';

export interface LegacySessionsRouterDeps {
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

/**
 * Cross-checks a LegacyAgentSpec against the YAML catalogs and the server's
 * capabilities before a session is created or updated.
 */
function validateAgentSpecLegacy(
  spec: LegacyAgentSpec,
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

/** YAML-backed sessions (mounted at /api/v1/legacy/sessions). */
export function createLegacySessionsRouter(deps: LegacySessionsRouterDeps) {
  const createSessionHandler: RouteHandler<typeof legacyCreateSessionRoute> = async c => {
    const body = c.req.valid('json');
    const specError = validateAgentSpecLegacy(body.agent_spec, deps);
    if (specError) {
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

  const getSessionHandler: RouteHandler<typeof legacyGetSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const deleteSessionHandler: RouteHandler<typeof legacyDeleteSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    await deps.sessionStore.deleteSession({ tenant_id: TENANT_ID, session_id: sessionId });
    return c.body(null, 204);
  };

  const updateSessionHandler: RouteHandler<typeof legacyUpdateSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.agent_spec) {
      const specError = validateAgentSpecLegacy(body.agent_spec, deps);
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

  const listSessionsHandler: RouteHandler<typeof legacyListSessionsRoute> = async c => {
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
  const cancelSessionHandler: RouteHandler<typeof legacyCancelSessionRoute> = async c => {
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

  const listSessionEventsHandler: RouteHandler<typeof legacyListSessionEventsRoute> = async c => {
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
  router.openapi(legacyCreateSessionRoute, createSessionHandler);
  router.openapi(legacyGetSessionRoute, getSessionHandler);
  router.openapi(legacyDeleteSessionRoute, deleteSessionHandler);
  router.openapi(legacyUpdateSessionRoute, updateSessionHandler);
  router.openapi(legacyListSessionsRoute, listSessionsHandler);
  router.openapi(legacyCancelSessionRoute, cancelSessionHandler);
  deps.requestReplyRouter.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(deps.activeTurns));
  router.openapi(legacyListSessionEventsRoute, listSessionEventsHandler);
  return router;
}
