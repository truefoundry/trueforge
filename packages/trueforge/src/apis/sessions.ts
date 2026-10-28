/**
 * DB-backed sessions APIs (mounted at /api/v1/sessions and /api/internal/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type {
  AgentSpec,
  ISessionStore,
  SessionHandle,
  SessionRecord,
  Sessions,
} from '@truefoundry/trueforge-core/agent-session';
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
  type RedisClient,
  type RouteHandler as RequestReplyRouteHandler,
  type RequestReplyRouter,
} from '@truefoundry/trueforge-core/request-reply';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { ResolveSkillStoreInput } from '../app';
import type { Authorizer } from '../auth/authorizer';
import { createdBySubjectFromRequestContext, type RequestContext, type ResolveRequestContext } from '../auth/identity';
import configuration from '../config';
import type { AccessGrantRecord, IAccessControlStore } from '../db/accessControlStore';
import type { IAgentStore } from '../db/agentStore';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import type { IUserStore } from '../db/userStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { updateLogContext } from '../logger';
import {
  cancelSessionRoute,
  createSessionRoute,
  deleteSessionRoute,
  getOrCreateSessionByExternalIdRoute,
  getSessionRoute,
  listSessionEventsRoute,
  listSessionGrantsRoute,
  listSessionsRoute,
  updateSessionGrantsRoute,
  updateSessionRoute,
} from '../routes/sessionRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { validateAgentSpec } from '../runtime/sessionResources';
import { honoQueriesToRecord } from '../schemas/deepObjectQuery';
import { isSessionAgentNameRef, parseListSessionsQuery, type Session } from '../schemas/session';
import type { SessionGrant, SessionGrantSubject } from '../schemas/sessionGrant';
import { newId } from '../utils/id';
import { agentIfAccessible, canReadAgentBoundResource, canReadSession, resolveManagedAgentIds } from './agentAccess';

/** Request-reply path a replica serves to cancel a turn it owns. */
export const SESSIONS_CANCEL_PATH = 'sessions/cancel';

/** Wire body of a peer cancel; validated on receipt (it crosses processes via Redis). */
const CancelPeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  reason: z.enum(CancellationReason),
});
type CancelPeerBody = z.infer<typeof CancelPeerBodySchema>;

/** `shared` is whether the session holds a `tenant` grant. */
export function toWireSession(record: SessionRecord, shared: boolean): Session {
  return {
    id: record.session_id,
    agent: record.agent,
    title: record.title,
    shared,
    created_by_subject: record.created_by_subject,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    metrics: record.metrics,
    metadata: record.metadata,
    source: record.source,
    last_turn_details: record.last_turn_details,
  };
}

export interface SessionsRouterDeps<TTransaction = never> {
  sessions: Sessions;
  sessionStore: ISessionStore;
  accessControlStore: IAccessControlStore<TTransaction>;
  userStore: IUserStore;
  withTransaction: WithTransaction<TTransaction>;
  activeTurns: ActiveTurnRegistry;
  resolveModelProviderStore: (input: { c: Context; allowInlineResources?: boolean }) => IModelProviderStore;
  resolveMcpServerStore: (input: { c: Context; allowInlineResources?: boolean }) => IMcpServerStore;
  resolveSkillStore: (input: ResolveSkillStoreInput) => ISkillStore;
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
  redis?: RedisClient | undefined;
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
  // Cancel is POST /sessions/{session_id}/cancel — path middleware has session_id only.
  updateLogContext({ turn_id: turnId });

  const turn = await deps.sessionStore.getTurn({
    session_id: sessionId,
    turn_id: turnId,
  });
  if (turn?.state.status !== 'running') {
    // Missing or already terminal — nothing to cancel.
    return;
  }

  const owner = turn.active_executor_id;
  // Without a Redis client there is no peer to ask, so a different owner falls
  // through to the local lookup and freezes if the run is gone.
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
        turn_id: turnId,
        owner,
        ...extractErrorLogFields(error),
      };
      if (error instanceof RequestTimeoutError) {
        deps.logger.warn('Timed out waiting for owning executor to cancel; freezing the running turn', {
          ...fields,
          reportable_error: { error, extra: { turn_id: turnId, owner } },
        });
      } else {
        deps.logger.warn('Failed to reach owning executor over Redis; freezing the running turn', {
          ...fields,
          reportable_error: { error, extra: { turn_id: turnId, owner } },
        });
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

function isSessionOwner({
  subject_id,
  created_by_subject,
}: {
  subject_id: string;
  created_by_subject: { subject_id: string };
}): boolean {
  return subject_id === created_by_subject.subject_id;
}

const FORBIDDEN_SESSION_ACCESS_MANAGEMENT = 'Only the session creator can manage access to this session';

/** Session the caller created; 404 when missing, 403 for anyone else. */
async function requireOwnedSession(
  deps: Pick<SessionsRouterDeps, 'sessionStore' | 'resolveRequestContext'>,
  input: { c: Context; session_id: string },
): Promise<{ requestContext: RequestContext; record: SessionRecord }> {
  const requestContext = deps.resolveRequestContext(input.c);
  const record = await deps.sessionStore.getSession({
    tenant_id: requestContext.tenant_id,
    session_id: input.session_id,
  });
  if (!record) {
    throw new HTTPException(404, { message: `Session not found: ${input.session_id}` });
  }
  if (!isSessionOwner({ subject_id: requestContext.subject.id, created_by_subject: record.created_by_subject })) {
    throw new HTTPException(403, { message: FORBIDDEN_SESSION_ACCESS_MANAGEMENT });
  }
  return { requestContext, record };
}

function subjectKey(subject: SessionGrantSubject): string {
  return `${subject.subject_type}:${subject.subject_id}`;
}

function uniqueSubjects(subjects: readonly SessionGrantSubject[]): SessionGrantSubject[] {
  const byKey = new Map<string, SessionGrantSubject>();
  for (const subject of subjects) {
    byKey.set(subjectKey(subject), subject);
  }
  return [...byKey.values()];
}

/** The ids among `session_ids` shared with everyone in the tenant, i.e. holding its `tenant` grant. */
async function tenantSharedSessionIds<TTransaction>(
  accessControlStore: IAccessControlStore<TTransaction>,
  input: { tenant_id: string; session_ids: readonly string[] },
): Promise<Set<string>> {
  const grants = await accessControlStore.listAccessGrants({
    tenant_id: input.tenant_id,
    session_ids: input.session_ids,
    subjects: [{ subject_type: 'tenant', subject_id: input.tenant_id }],
  });
  return new Set(grants.map(grant => grant.session_id));
}

async function isSharedWithTenant<TTransaction>(
  accessControlStore: IAccessControlStore<TTransaction>,
  input: { tenant_id: string; session_id: string },
): Promise<boolean> {
  const sharedIds = await tenantSharedSessionIds(accessControlStore, {
    tenant_id: input.tenant_id,
    session_ids: [input.session_id],
  });
  return sharedIds.has(input.session_id);
}

/** Deprecated `PATCH { shared }`: sharing with everyone is the `tenant` grant. */
async function setSharedWithTenant<TTransaction>(
  accessControlStore: IAccessControlStore<TTransaction>,
  input: { requestContext: RequestContext; session_id: string; shared: boolean },
): Promise<void> {
  const { requestContext, session_id } = input;
  const subjects: SessionGrantSubject[] = [{ subject_type: 'tenant', subject_id: requestContext.tenant_id }];
  if (input.shared) {
    await accessControlStore.createAccessGrants({
      tenant_id: requestContext.tenant_id,
      session_id,
      subjects,
      granted_by_subject: createdBySubjectFromRequestContext(requestContext),
    });
    return;
  }
  await accessControlStore.deleteAccessGrants({ tenant_id: requestContext.tenant_id, session_id, subjects });
}

function toWireSessionGrant(record: AccessGrantRecord): SessionGrant {
  return {
    subject: { subject_type: record.subject_type, subject_id: record.subject_id },
    granted_by_subject: record.granted_by_subject,
    created_at: record.created_at,
  };
}

/**
 * Inline create and spec replace check model, MCP, and skill names against `x-tfg-*` when those
 * headers are present. The headers are not written onto the session.
 */
function validateInlineSessionSpec(
  deps: Pick<
    SessionsRouterDeps,
    | 'resolveModelProviderStore'
    | 'resolveMcpServerStore'
    | 'resolveSkillStore'
    | 'resolveSandboxProviderStore'
    | 'sandboxEnvironmentStore'
    | 'resolveWebSearchProviderStore'
  >,
  input: { c: Context; spec: AgentSpec; requestContext: RequestContext },
): Promise<void> {
  const { c, spec, requestContext } = input;
  return validateAgentSpec({
    spec,
    tenant_id: requestContext.tenant_id,
    created_by_subject_id: requestContext.subject.id,
    modelProviderStore: deps.resolveModelProviderStore({ c, allowInlineResources: true }),
    mcpServerStore: deps.resolveMcpServerStore({ c, allowInlineResources: true }),
    skillStore: deps.resolveSkillStore({ c, allowInlineResources: true }),
    sandboxProviderStore: deps.resolveSandboxProviderStore(c),
    sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
    webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
  });
}

type InternalSessionsRouterDeps = Pick<
  SessionsRouterDeps,
  | 'sessions'
  | 'accessControlStore'
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
      const shared = await isSharedWithTenant(deps.accessControlStore, {
        tenant_id: requestContext.tenant_id,
        session_id: existing.record.session_id,
      });
      return c.json({ data: toWireSession(existing.record, shared) }, 200);
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
      await validateInlineSessionSpec(deps, {
        c,
        spec: body.agent.spec,
        requestContext,
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
    if (created) {
      return c.json({ data: toWireSession(session.record, false) }, 201);
    }
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
    const shared = await isSharedWithTenant(deps.accessControlStore, {
      tenant_id: requestContext.tenant_id,
      session_id: session.record.session_id,
    });
    return c.json({ data: toWireSession(session.record, shared) }, 200);
  };
}

/** Internal session operations (mounted at /api/internal/sessions). */
export function createInternalSessionsRouter(deps: InternalSessionsRouterDeps) {
  const router = new OpenAPIHono();
  router.openapi(getOrCreateSessionByExternalIdRoute, createGetOrCreateSessionByExternalIdHandler(deps));
  return router;
}

/** DB-backed sessions (mounted at /api/v1/sessions). */
export function createSessionsRouter<TTransaction>(deps: SessionsRouterDeps<TTransaction>) {
  const createSessionHandler: RouteHandler<typeof createSessionRoute> = async c => {
    const body = c.req.valid('json');
    const sessionId = newId();
    updateLogContext({ session_id: sessionId });
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
      return c.json({ data: toWireSession(session.record, false) }, 201);
    }

    await validateInlineSessionSpec(deps, {
      c,
      spec: body.agent.spec,
      requestContext,
    });
    const session = await deps.sessions.create({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
      created_by_subject: createdBySubjectFromRequestContext(requestContext),
      agent: { type: 'inline', spec: body.agent.spec },
      metadata: body.metadata,
      external_id: null,
    });
    return c.json({ data: toWireSession(session.record, false) }, 201);
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
      session_id: sessionId,
      accessControlStore: deps.accessControlStore,
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: record.agent.type === 'reference' ? record.agent.id : undefined,
      created_by_subject_id: record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const shared = await isSharedWithTenant(deps.accessControlStore, {
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    return c.json({ data: toWireSession(record, shared) }, 200);
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
      if (existing.agent.type === 'inline') {
        await validateInlineSessionSpec(deps, {
          c,
          spec: body.agent.spec,
          requestContext,
        });
      } else {
        await validateAgentSpec({
          spec: body.agent.spec,
          tenant_id: requestContext.tenant_id,
          created_by_subject_id: requestContext.subject.id,
          modelProviderStore: deps.resolveModelProviderStore({ c }),
          mcpServerStore: deps.resolveMcpServerStore({ c }),
          skillStore: deps.resolveSkillStore({ c }),
          sandboxProviderStore: deps.resolveSandboxProviderStore(c),
          sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
          webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
        });
      }
    }
    try {
      await deps.sessionStore.updateSession({
        tenant_id: requestContext.tenant_id,
        session_id: sessionId,
        agent: body.agent === undefined ? undefined : { type: 'inline', spec: body.agent.spec },
        title: body.title,
        metadata: body.metadata,
      });
    } catch (error) {
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
      }
      if (error instanceof SessionStoreInvariantError) {
        throw new HTTPException(422, { message: error.message, cause: error });
      }
      throw error;
    }
    if (body.shared !== undefined) {
      await setSharedWithTenant(deps.accessControlStore, {
        requestContext,
        session_id: sessionId,
        shared: body.shared,
      });
    }
    const record = await deps.sessionStore.getSession({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!record) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const shared = await isSharedWithTenant(deps.accessControlStore, {
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    return c.json({ data: toWireSession(record, shared) }, 200);
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
      const sharedIds = await tenantSharedSessionIds(deps.accessControlStore, {
        tenant_id: requestContext.tenant_id,
        session_ids: data.map(record => record.session_id),
      });
      return c.json(
        { data: data.map(record => toWireSession(record, sharedIds.has(record.session_id))), pagination },
        200,
      );
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        throw new HTTPException(400, { message: error.message, cause: error });
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
    const turnId = session.record.last_turn_details?.id;
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
      session_id: sessionId,
      accessControlStore: deps.accessControlStore,
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
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
      throw error;
    }
  };

  const listSessionGrantsHandler: RouteHandler<typeof listSessionGrantsRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const { requestContext } = await requireOwnedSession(deps, { c, session_id: sessionId });
    const records = await deps.accessControlStore.listAccessGrants({
      tenant_id: requestContext.tenant_id,
      session_ids: [sessionId],
    });
    return c.json({ data: records.map(toWireSessionGrant) }, 200);
  };

  const updateSessionGrantsHandler: RouteHandler<typeof updateSessionGrantsRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    const { requestContext } = await requireOwnedSession(deps, { c, session_id: sessionId });
    const toGrant = uniqueSubjects(body.grant);
    const toRevoke = uniqueSubjects(body.revoke);
    const revokeKeys = new Set(toRevoke.map(subjectKey));
    if (toGrant.some(subject => revokeKeys.has(subjectKey(subject)))) {
      throw new HTTPException(422, { message: 'A subject cannot be both granted and revoked.' });
    }
    if (toGrant.some(subject => subject.subject_type === 'tenant' && subject.subject_id !== requestContext.tenant_id)) {
      throw new HTTPException(422, { message: 'A tenant subject must be your own tenant.' });
    }
    const userIds = toGrant.filter(subject => subject.subject_type === 'user').map(subject => subject.subject_id);
    if (userIds.includes(requestContext.subject.id)) {
      throw new HTTPException(422, { message: 'The session creator already has access.' });
    }
    if (userIds.length > 0) {
      const knownUsers = await deps.userStore.getUsersByIds({ context: requestContext, ids: userIds });
      const knownIds = new Set(knownUsers.map(user => user.id));
      const unknownIds = userIds.filter(id => !knownIds.has(id));
      if (unknownIds.length > 0) {
        throw new HTTPException(422, { message: `Unknown users: ${unknownIds.join(', ')}` });
      }
    }
    await deps.withTransaction(async transaction => {
      if (toGrant.length > 0) {
        await deps.accessControlStore.createAccessGrants(
          {
            tenant_id: requestContext.tenant_id,
            session_id: sessionId,
            subjects: toGrant,
            granted_by_subject: createdBySubjectFromRequestContext(requestContext),
          },
          transaction,
        );
      }
      if (toRevoke.length > 0) {
        await deps.accessControlStore.deleteAccessGrants(
          { tenant_id: requestContext.tenant_id, session_id: sessionId, subjects: toRevoke },
          transaction,
        );
      }
    });
    const records = await deps.accessControlStore.listAccessGrants({
      tenant_id: requestContext.tenant_id,
      session_ids: [sessionId],
    });
    return c.json({ data: records.map(toWireSessionGrant) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(createSessionRoute, createSessionHandler);
  router.openapi(getSessionRoute, getSessionHandler);
  router.openapi(deleteSessionRoute, deleteSessionHandler);
  router.openapi(updateSessionRoute, updateSessionHandler);
  router.openapi(listSessionsRoute, listSessionsHandler);
  router.openapi(cancelSessionRoute, cancelSessionHandler);
  router.openapi(listSessionEventsRoute, listSessionEventsHandler);
  router.openapi(listSessionGrantsRoute, listSessionGrantsHandler);
  router.openapi(updateSessionGrantsRoute, updateSessionGrantsHandler);
  deps.requestReplyRouter.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(deps.activeTurns));
  return router;
}
