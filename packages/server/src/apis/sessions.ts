import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { AgentSpec, ISessionStore, SessionRecord, Sessions } from '@truefoundry/utils/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
} from '@truefoundry/utils/agent-session';
import { ulid } from 'ulid';
import {
  cancelSessionRoute,
  createSessionRoute,
  getSessionRoute,
  listSessionEventsRoute,
  listSessionsRoute,
  updateSessionRoute,
} from '../routes/sessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import type { Session } from '../schemas/session';
import type { McpStore } from '../store/McpStore';
import type { ModelStore } from '../store/ModelStore';

/** The server is single-tenant; every record lives under one fixed tenant scope. */
export const TENANT_NAME = 'default';

export function toWireSession(record: SessionRecord): Session {
  return {
    id: record.session_id,
    agent_spec: record.agent_spec,
    title: record.title ?? null,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/**
 * Cross-checks an AgentSpec against the YAML catalogs and the server's
 * capabilities before a session is created or updated, so misconfigured specs
 * fail at admission instead of at turn time. Returns undefined when the spec
 * is usable; otherwise an error with the status to respond with: 400 when the
 * spec references unknown catalog entries (a client-side spec problem), 422
 * when the spec is valid but this deployment cannot satisfy it (missing
 * sandbox provider, unsupported skills).
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
  if (spec.config?.sandbox?.enabled && !deps.sandboxSupported) {
    return {
      status: 422,
      message:
        'sandbox is enabled in the agent spec but this server has no sandbox provider configured — set SANDBOX_SETTINGS (and SANDBOX_API_KEY)',
    };
  }
  if (spec.skills?.length) {
    return { status: 422, message: 'skills are not supported by this server yet' };
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
      tenant_name: TENANT_NAME,
      session_id: ulid().toLowerCase(),
      agent_spec: body.agent_spec,
    });
    return c.json({ data: toWireSession(session.record) }, 201);
  };

  const getSessionHandler: RouteHandler<typeof getSessionRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const record = await deps.sessionStore.getSession({ tenant_name: TENANT_NAME, session_id: sessionId });
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
        tenant_name: TENANT_NAME,
        session_id: sessionId,
        ...(body.agent_spec ? { agent_spec: body.agent_spec } : {}),
      });
    } catch (error) {
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
      }
      throw error;
    }
    const record = await deps.sessionStore.getSession({ tenant_name: TENANT_NAME, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const listSessionsHandler: RouteHandler<typeof listSessionsRoute> = async c => {
    const query = c.req.valid('query');
    try {
      const { data, pagination } = await deps.sessionStore.listSessions({
        tenant_name: TENANT_NAME,
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
    const record = await deps.sessionStore.getSession({ tenant_name: TENANT_NAME, session_id: sessionId });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (record.last_turn_id) {
      deps.activeTurns.cancelIfRunning({
        sessionId,
        turnId: record.last_turn_id,
        abortReason: CancellationReason.ClientCancelled,
      });
    }
    return c.json({}, 200);
  };

  const listSessionEventsHandler: RouteHandler<typeof listSessionEventsRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_name: TENANT_NAME, session_id: sessionId });
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
  router.openapi(listSessionEventsRoute, listSessionEventsHandler);
  return router;
}
