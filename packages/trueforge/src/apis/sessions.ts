/**
 * DB-backed sessions APIs (mounted at /api/v1/sessions and /api/internal/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, SessionRecord, Sessions } from '@truefoundry/trueforge-core/agent-session';
import {
  SessionStoreConflictError,
  SessionStoreInvariantError,
  SessionStoreNotFoundError,
} from '@truefoundry/trueforge-core/agent-session';
import { type RedisClient, type RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import type { Authorizer } from '../auth/authorizer';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import {
  cancelSessionRoute,
  createSessionRoute,
  deleteSessionRoute,
  getOrCreateSessionByExternalIdRoute,
  getSessionRoute,
  listSessionEventsRoute,
  listSessionsRoute,
  updateSessionRoute,
} from '../routes/sessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { cancelSessionTurn, cancelSessionTurnPeerHandler, SESSIONS_CANCEL_PATH } from '../runtime/cancelTurn';
import { validateAgentSpec } from '../runtime/sessionResources';
import { honoQueriesToRecord } from '../schemas/deepObjectQuery';
import { isSessionAgentNameRef, parseListSessionsQuery, type Session } from '../schemas/session';
import { newId } from '../utils/id';
import { agentIfAccessible, canReadAgentBoundResource, canReadSession, resolveManagedAgentIds } from './agentAccess';
import type { ResolveSkillStore } from './skills';

export { cancelSessionTurn, cancelSessionTurnPeerHandler, SESSIONS_CANCEL_PATH } from '../runtime/cancelTurn';
export type { CancelTurnDeps } from '../runtime/cancelTurn';

export function toWireSession(record: SessionRecord): Session {
  return {
    id: record.session_id,
    agent: record.agent,
    title: record.title,
    shared: record.shared,
    created_by_subject: record.created_by_subject,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    metrics: record.metrics,
    metadata: record.metadata,
    source: record.source,
  };
}

export interface SessionsRouterDeps {
  sessions: Sessions;
  sessionStore: ISessionStore;
  activeTurns: ActiveTurnRegistry;
  resolveModelProviderStore: (c: Context) => IModelProviderStore;
  resolveMcpServerStore: (c: Context) => IMcpServerStore;
  resolveSkillStore: ResolveSkillStore;
  resolveAgentStore: (c: Context) => IAgentStore;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  redis?: RedisClient | undefined;
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore;
  requestReplyRouter: RequestReplyRouter;
  resolveRequestContext: ResolveRequestContext;
  logger: Logger;
  authorizer: Authorizer;
}

const FORBIDDEN_SESSION_ACCESS = 'Only the session creator can access this session';

function isSessionOwner({
  subject_id,
  created_by_subject,
}: {
  subject_id: string;
  created_by_subject: { subject_id: string };
}): boolean {
  return subject_id === created_by_subject.subject_id;
}

type InternalSessionsRouterDeps = Pick<
  SessionsRouterDeps,
  | 'sessions'
  | 'resolveModelProviderStore'
  | 'resolveMcpServerStore'
  | 'resolveSkillStore'
  | 'resolveAgentStore'
  | 'resolveSandboxProviderStore'
  | 'sandboxEnvironmentStore'
  | 'resolveWebSearchProviderStore'
  | 'resolveRequestContext'
  | 'authorizer'
>;

function createGetOrCreateSessionByExternalIdHandler(
  deps: InternalSessionsRouterDeps,
): RouteHandler<typeof getOrCreateSessionByExternalIdRoute> {
  return async c => {
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);

    const existing = await deps.sessions.getByExternalId({
      tenant_id: requestContext.tenant_id,
      external_id: body.external_id,
    });
    if (existing !== undefined) {
      const allowed = await canReadAgentBoundResource({
        store: deps.resolveAgentStore(c),
        context: requestContext,
        authorizer: deps.authorizer,
        agent_id: existing.record.agent.type === 'reference' ? existing.record.agent.id : undefined,
        created_by_subject_id: existing.record.created_by_subject.subject_id,
      });
      if (!allowed) {
        return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
      }
      return c.json({ data: toWireSession(existing.record) }, 200);
    }

    let agent: SessionRecord['agent'];
    if (isSessionAgentNameRef(body.agent)) {
      const named = await agentIfAccessible({
        authorizer: deps.authorizer,
        context: requestContext,
        action: 'use',
        agent: await deps.resolveAgentStore(c).getAgent({
          tenant_id: requestContext.tenant_id,
          name: body.agent.name,
        }),
      });
      if (named === undefined) {
        return c.json({ error: { message: `Agent not found: ${body.agent.name}` } }, 404);
      }
      agent = { type: 'reference', id: named.id, name: named.name };
    } else {
      await validateAgentSpec({
        spec: body.agent.spec,
        tenant_id: requestContext.tenant_id,
        created_by_subject_id: requestContext.subject.id,
        modelProviderStore: deps.resolveModelProviderStore(c),
        mcpServerStore: deps.resolveMcpServerStore(c),
        skillStore: deps.resolveSkillStore(c),
        sandboxProviderStore: deps.resolveSandboxProviderStore(c),
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
      });
      agent = { type: 'inline', spec: body.agent.spec };
    }

    const { session, created } = await deps.sessions.getOrCreateByExternalId({
      tenant_id: requestContext.tenant_id,
      external_id: body.external_id,
      created_by_subject: createdBySubjectFromRequestContext(requestContext),
      agent,
      source: body.source ?? null,
    });
    if (!created) {
      const allowed = await canReadAgentBoundResource({
        store: deps.resolveAgentStore(c),
        context: requestContext,
        authorizer: deps.authorizer,
        agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
        created_by_subject_id: session.record.created_by_subject.subject_id,
      });
      if (!allowed) {
        return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
      }
    }
    return c.json({ data: toWireSession(session.record) }, created ? 201 : 200);
  };
}

/** Internal session operations (mounted at /api/internal/sessions). */
export function createInternalSessionsRouter(deps: InternalSessionsRouterDeps) {
  const router = new OpenAPIHono();
  router.openapi(getOrCreateSessionByExternalIdRoute, createGetOrCreateSessionByExternalIdHandler(deps));
  return router;
}

/** DB-backed sessions (mounted at /api/v1/sessions). */
export function createSessionsRouter(deps: SessionsRouterDeps) {
  const createSessionHandler: RouteHandler<typeof createSessionRoute> = async c => {
    const body = c.req.valid('json');
    const sessionId = newId();
    const requestContext = deps.resolveRequestContext(c);

    if (isSessionAgentNameRef(body.agent)) {
      const agent = await agentIfAccessible({
        authorizer: deps.authorizer,
        context: requestContext,
        action: 'use',
        agent: await deps.resolveAgentStore(c).getAgent({
          tenant_id: requestContext.tenant_id,
          name: body.agent.name,
        }),
      });
      if (agent === undefined) {
        return c.json({ error: { message: `Agent not found: ${body.agent.name}` } }, 404);
      }
      const session = await deps.sessions.create({
        tenant_id: requestContext.tenant_id,
        session_id: sessionId,
        created_by_subject: createdBySubjectFromRequestContext(requestContext),
        agent: { type: 'reference', id: agent.id, name: agent.name },
        metadata: body.metadata,
        external_id: null,
      });
      return c.json({ data: toWireSession(session.record) }, 201);
    }

    await validateAgentSpec({
      spec: body.agent.spec,
      tenant_id: requestContext.tenant_id,
      created_by_subject_id: requestContext.subject.id,
      modelProviderStore: deps.resolveModelProviderStore(c),
      mcpServerStore: deps.resolveMcpServerStore(c),
      skillStore: deps.resolveSkillStore(c),
      sandboxProviderStore: deps.resolveSandboxProviderStore(c),
      sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
      webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
    });
    const session = await deps.sessions.create({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
      created_by_subject: createdBySubjectFromRequestContext(requestContext),
      agent: { type: 'inline', spec: body.agent.spec },
      metadata: body.metadata,
      external_id: null,
    });
    return c.json({ data: toWireSession(session.record) }, 201);
  };

  const getSessionHandler: RouteHandler<typeof getSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.sessionStore.getSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadSession({
      shared: record.shared,
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: record.agent.type === 'reference' ? record.agent.id : undefined,
      created_by_subject_id: record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const deleteSessionHandler: RouteHandler<typeof deleteSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.sessionStore.getSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!record) {
      // Idempotent delete when already gone.
      return c.body(null, 204);
    }
    if (
      !isSessionOwner({
        subject_id: requestContext.subject.id,
        created_by_subject: record.created_by_subject,
      })
    ) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    await deps.sessionStore.deleteSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    return c.body(null, 204);
  };

  const updateSessionHandler: RouteHandler<typeof updateSessionRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const existing = await deps.sessionStore.getSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!existing) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (
      !isSessionOwner({
        subject_id: requestContext.subject.id,
        created_by_subject: existing.created_by_subject,
      })
    ) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    // Inline sessions may replace their agent; named (reference) sessions
    // cannot — the store rejects that with SessionStoreInvariantError → 422 below.
    if (body.agent !== undefined) {
      await validateAgentSpec({
        spec: body.agent.spec,
        tenant_id: requestContext.tenant_id,
        created_by_subject_id: requestContext.subject.id,
        modelProviderStore: deps.resolveModelProviderStore(c),
        mcpServerStore: deps.resolveMcpServerStore(c),
        skillStore: deps.resolveSkillStore(c),
        sandboxProviderStore: deps.resolveSandboxProviderStore(c),
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
      });
    }
    try {
      await deps.sessionStore.updateSession({
        tenant_id: requestContext.tenant_id,
        session_id: sessionId,
        agent: body.agent === undefined ? undefined : { type: 'inline', spec: body.agent.spec },
        title: body.title,
        metadata: body.metadata,
        shared: body.shared,
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
    const record = await deps.sessionStore.getSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    return c.json({ data: toWireSession(record) }, 200);
  };

  const listSessionsHandler: RouteHandler<typeof listSessionsRoute> = async c => {
    const query = parseListSessionsQuery(honoQueriesToRecord(c.req.queries()));
    const requestContext = deps.resolveRequestContext(c);
    try {
      const managedAgentIds = query.created_by_me
        ? []
        : await resolveManagedAgentIds({
            store: deps.resolveAgentStore(c),
            context: requestContext,
            authorizer: deps.authorizer,
          });
      const { data, pagination } = await deps.sessionStore.listSessions({
        agent_id: query.agent_id,
        created_by_or_agent_ids: {
          created_by_subject_id: requestContext.subject.id,
          agent_ids: managedAgentIds,
        },
        tenant_id: requestContext.tenant_id,
        metadata: query.metadata,
        limit: query.limit,
        order: query.order,
        page_token: query.page_token,
        start_timestamp: query.start_timestamp,
        end_timestamp: query.end_timestamp,
        source_type: query.source_type,
        source_id: query.source_id,
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
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (
      !isSessionOwner({
        subject_id: requestContext.subject.id,
        created_by_subject: session.record.created_by_subject,
      })
    ) {
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
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadSession({
      shared: session.record.shared,
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
      created_by_subject_id: session.record.created_by_subject.subject_id,
    });
    if (!allowed) {
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
