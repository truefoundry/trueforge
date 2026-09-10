/**
 * Schedules API (mounted at /api/v1/schedules).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  InvalidPageTokenError,
  type Sessions,
  type TurnStreamingEvent,
} from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import type { Authorizer } from '../auth/authorizer';
import {
  createdBySubjectFromRequestContext,
  requestContextFromCreatedBySubject,
  type RequestContext,
  type ResolveRequestContext,
} from '../auth/identity';
import {
  loadScheduleDispatchItem,
  ScheduleAgentNotFoundError,
  ScheduleNotFoundError,
  scheduleRunFailureReason,
  ScheduleRunNotFoundError,
  startScheduleRun,
} from '../controller/scheduleDispatch';
import type { AgentRecord, IAgentStore } from '../db/agentStore';
import type { IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import {
  manualRunName,
  ScheduleNameConflictError,
  ScheduleRunConflictError,
  type IScheduleStore,
  type ScheduleDispatchItem,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from '../db/scheduleStore';
import type { ISkillStore } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createScheduleRoute,
  createScheduleRunRoute,
  deleteScheduleRoute,
  executeScheduleRunRoute,
  getScheduleRoute,
  listScheduleRunsRoute,
  listSchedulesRoute,
  putScheduleRoute,
} from '../routes/scheduleRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { minIntervalSeconds, nextTriggerAfter } from '../runtime/cron';
import type { EventSubscriptionRegistry } from '../runtime/event-subscription';
import {
  InvalidCronError,
  SCHEDULE_MIN_INTERVAL_SECONDS,
  type Schedule,
  type ScheduleManifest,
  type ScheduleRun,
} from '../schemas/schedule';
import { agentIfAccessible, canReadAgentBoundResource, resolveManagedAgentIds } from './agentAccess';
import { getTurnExecutionError, startTurnInProcess } from './turns';

/** Runtime + Context store resolvers needed to start a schedule turn. */
export interface ScheduleTurnExecutionDeps<TTransaction> {
  scheduleStore: IScheduleStore<TTransaction>;
  sessions: Sessions;
  /** Persistence agent store (schedule agent binding is not caller-scoped). */
  agentStore: IAgentStore<TTransaction>;
  activeTurns: ActiveTurnRegistry;
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
  resolveModelProviderStore: (c: Context, runAsAgent?: AgentRecord) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c: Context, runAsAgent?: AgentRecord) => IMcpServerWithAuthStore<TTransaction>;
  resolveSkillStore: (c: Context) => ISkillStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
}

export interface SchedulesRouterDeps<TTransaction> extends ScheduleTurnExecutionDeps<TTransaction> {
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  authorizer: Authorizer;
}

/**
 * Prepare and start a schedule run using Context-based store resolvers. Caller must set
 * `request_context` (typically via {@link requestContextFromCreatedBySubject})
 * before calling.
 */
export async function startScheduleRunOnRequest<TTransaction>(params: {
  c: Context;
  item: ScheduleDispatchItem;
  deps: ScheduleTurnExecutionDeps<TTransaction>;
}): Promise<void> {
  const { c, item, deps } = params;
  const prepared = await startScheduleRun({
    item,
    sessions: deps.sessions,
    agentStore: deps.agentStore,
  });
  if (prepared === undefined) {
    return;
  }
  await startTurnInProcess({
    session: prepared.session,
    input: prepared.input,
    previous_turn_id: prepared.previous_turn_id,
    userRef: prepared.userRef,
    deps: {
      activeTurns: deps.activeTurns,
      eventSubscriptions: deps.eventSubscriptions,
      modelProviderStore: deps.resolveModelProviderStore(c, prepared.agent),
      mcpServerStore: deps.resolveMcpServerStore(c, prepared.agent),
      skillStore: deps.resolveSkillStore(c),
      agentStore: deps.agentStore,
      sandboxProviderStore: deps.resolveSandboxProviderStore(c),
      logger: deps.logger,
    },
  });
}

function toWireSchedule(record: ScheduleRecord): Schedule {
  return {
    id: record.id,
    agent_name: record.agent_name,
    name: record.name,
    manifest: record.manifest,
    created_by_subject: record.created_by_subject,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function toWireScheduleRun(record: ScheduleRunRecord): ScheduleRun {
  return {
    id: record.id,
    schedule_id: record.schedule_id,
    name: record.name,
    scheduled_for: record.scheduled_for,
    status: record.status,
    created_by_subject: record.created_by_subject,
    triggered_at: record.triggered_at,
    reason: record.reason,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function validateManifest(manifest: Pick<ScheduleManifest, 'cron' | 'timezone'>, from: Date = new Date()): void {
  // Reject if the cron has no upcoming trigger time (impossible / exhausted calendar).
  // 5-field cron has no year, so a valid expression always recurs — no one-shot check.
  try {
    nextTriggerAfter({ cron: manifest.cron, timezone: manifest.timezone, from });
  } catch (error) {
    throw new InvalidCronError(`Cron expression "${manifest.cron}" has no next trigger time in ${manifest.timezone}`, {
      cause: error,
    });
  }

  // Reject expressions that trigger < SCHEDULE_MIN_INTERVAL_SECONDS seconds apart.
  let tightest: number;
  try {
    tightest = minIntervalSeconds(manifest, from);
  } catch (error) {
    throw new InvalidCronError(`Cron expression "${manifest.cron}" has no next trigger time in ${manifest.timezone}`, {
      cause: error,
    });
  }

  if (tightest < SCHEDULE_MIN_INTERVAL_SECONDS) {
    throw new InvalidCronError(
      `Cron expression "${manifest.cron}" triggers every ${String(tightest)}s; the minimum interval is ${String(
        SCHEDULE_MIN_INTERVAL_SECONDS,
      )}s`,
    );
  }
}

const FORBIDDEN_SCHEDULE_ACCESS = 'Only the schedule creator can access this schedule';

/** Schedule mutations remain creator-only in every auth mode. */
function isScheduleOwner(requestContext: Pick<RequestContext, 'subject'>, created_by_subject_id: string): boolean {
  return requestContext.subject.id === created_by_subject_id;
}

export function createScheduleExecutionRouter<TTransaction>(deps: ScheduleTurnExecutionDeps<TTransaction>) {
  const handler: RouteHandler<typeof executeScheduleRunRoute> = async c => {
    const { schedule_run_id: scheduleRunId } = c.req.valid('json');
    try {
      const item = await loadScheduleDispatchItem({
        scheduleRunId,
        scheduleStore: deps.scheduleStore,
      });
      c.set(
        'request_context',
        requestContextFromCreatedBySubject({
          tenant_id: item.schedule.tenant_id,
          created_by_subject: item.schedule.created_by_subject,
        }),
      );
      await startScheduleRunOnRequest({ c, item, deps });
    } catch (error) {
      if (
        error instanceof ScheduleRunNotFoundError ||
        error instanceof ScheduleNotFoundError ||
        error instanceof ScheduleAgentNotFoundError
      ) {
        return c.json({ error: { message: error.message } }, 404);
      }
      throw error;
    }
    return c.body(null, 204);
  };

  const router = new OpenAPIHono();
  router.openapi(executeScheduleRunRoute, handler);
  return router;
}

export function createSchedulesRouter<TTransaction>(deps: SchedulesRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listSchedulesRoute> = async c => {
    const { agent_names: agentNames, limit, page_token: pageToken, created_by_me: createdByMe } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    try {
      const managedAgentIds = createdByMe
        ? []
        : await resolveManagedAgentIds({
            store: deps.resolveAgentStore(c),
            context: requestContext,
            authorizer: deps.authorizer,
          });
      const { data, pagination } = await deps.scheduleStore.listSchedules({
        tenant_id: requestContext.tenant_id,
        limit,
        page_token: pageToken,
        agent_names: agentNames,
        created_by_or_agent_ids: {
          created_by_subject_id: requestContext.subject.id,
          agent_ids: managedAgentIds,
        },
      });
      return c.json({ data: data.map(toWireSchedule), pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const listRunsHandler: RouteHandler<typeof listScheduleRunsRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const { limit, page_token: pageToken } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    const schedule = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (schedule === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    if (
      !(await canReadAgentBoundResource({
        store: deps.resolveAgentStore(c),
        context: requestContext,
        authorizer: deps.authorizer,
        agent_id: schedule.agent_id,
        created_by_subject_id: schedule.created_by_subject.subject_id,
      }))
    ) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }
    try {
      const { data, pagination } = await deps.scheduleStore.listRuns({
        tenant_id: requestContext.tenant_id,
        schedule_id: scheduleId,
        limit,
        page_token: pageToken,
      });
      return c.json({ data: data.map(toWireScheduleRun), pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const createScheduleRunHandler: RouteHandler<typeof createScheduleRunRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);

    const schedule = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (schedule === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    if (!isScheduleOwner(requestContext, schedule.created_by_subject.subject_id)) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }

    // Schedule ownership alone must not invoke an agent the caller cannot use.
    const agent = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'use',
      agent: await deps.resolveAgentStore(c).getAgent({
        tenant_id: requestContext.tenant_id,
        name: schedule.agent_name,
      }),
    });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${schedule.agent_name}` } }, 404);
    }

    const now = new Date();
    let run: ScheduleRunRecord;
    try {
      run = await deps.scheduleStore.createRun({
        tenant_id: requestContext.tenant_id,
        schedule_id: schedule.id,
        name: manualRunName(),
        scheduled_for: now,
        status: 'triggered',
        created_by_subject: createdBySubjectFromRequestContext(requestContext),
        triggered_at: now,
      });
    } catch (error) {
      if (error instanceof ScheduleRunConflictError) {
        return c.json({ error: { message: `${error.message}. Retry the request.` } }, 409);
      }
      throw error;
    }

    try {
      await startScheduleRunOnRequest({ c, item: { run, schedule }, deps });
    } catch (error) {
      await deps.scheduleStore.updateRunStatus({
        tenant_id: requestContext.tenant_id,
        id: run.id,
        status: 'failed',
        reason: scheduleRunFailureReason(error),
      });

      if (
        error instanceof ScheduleRunNotFoundError ||
        error instanceof ScheduleNotFoundError ||
        error instanceof ScheduleAgentNotFoundError
      ) {
        return c.json({ error: { message: error.message } }, 404);
      }
      const turnError = getTurnExecutionError(error);
      if (turnError) {
        return c.json({ error: { message: turnError.message } }, turnError.status);
      }
      throw error;
    }

    const latest = await deps.scheduleStore.getRun({
      tenant_id: requestContext.tenant_id,
      id: run.id,
    });
    return c.json({ data: toWireScheduleRun(latest ?? run) }, 201);
  };

  const createHandler: RouteHandler<typeof createScheduleRoute> = async c => {
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);

    validateManifest(body.manifest);

    const agent = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'use',
      agent: await deps.resolveAgentStore(c).getAgent({ tenant_id: requestContext.tenant_id, name: body.agent_name }),
    });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${body.agent_name}` } }, 404);
    }

    let record: ScheduleRecord;
    try {
      record = await deps.withTransaction(async transaction => {
        const { schedule } = await deps.scheduleStore.createScheduleAndRun(
          {
            tenant_id: requestContext.tenant_id,
            agent_id: agent.id,
            agent_name: agent.name,
            name: body.name,
            manifest: body.manifest,
            created_by_subject: createdBySubjectFromRequestContext(requestContext),
            runFrom: new Date(),
          },
          transaction,
        );
        return schedule;
      });
    } catch (error) {
      if (error instanceof ScheduleNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      if (error instanceof ScheduleRunConflictError) {
        return c.json({ error: { message: `${error.message}. Retry the request.` } }, 409);
      }
      throw error;
    }

    return c.json({ data: toWireSchedule(record) }, 201);
  };

  const getHandler: RouteHandler<typeof getScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (record === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    if (
      !(await canReadAgentBoundResource({
        store: deps.resolveAgentStore(c),
        context: requestContext,
        authorizer: deps.authorizer,
        agent_id: record.agent_id,
        created_by_subject_id: record.created_by_subject.subject_id,
      }))
    ) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }
    return c.json({ data: toWireSchedule(record) }, 200);
  };

  /**
   * Replaces the whole document, like every other manifest PUT in this server: an
   * omitted optional field is not "left alone", it returns to its default — omitting
   * `status` re-activates a paused schedule, omitting `timezone` moves it to UTC.
   * Read-modify-write if that is not what you want.
   *
   * Agent binding is immutable — a schedule that should point at a different agent is
   * a different schedule. `name` is editable but must stay unique within the agent;
   * renaming onto a taken name is a 409.
   */
  const putHandler: RouteHandler<typeof putScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);

    validateManifest(body.manifest);

    const existing = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (existing === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    if (!isScheduleOwner(requestContext, existing.created_by_subject.subject_id)) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }

    let record: ScheduleRecord | undefined;
    try {
      record = await deps.withTransaction(async transaction => {
        const result = await deps.scheduleStore.updateScheduleAndRun(
          {
            tenant_id: requestContext.tenant_id,
            id: scheduleId,
            name: body.name,
            manifest: body.manifest,
            runFrom: new Date(),
          },
          transaction,
        );
        return result?.schedule;
      });
    } catch (error) {
      if (error instanceof ScheduleNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      if (error instanceof ScheduleRunConflictError) {
        return c.json({ error: { message: `${error.message}. Retry the request.` } }, 409);
      }
      throw error;
    }

    if (record === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    return c.json({ data: toWireSchedule(record) }, 200);
  };

  const deleteHandler: RouteHandler<typeof deleteScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (record === undefined) {
      return c.json({}, 200);
    }
    if (!isScheduleOwner(requestContext, record.created_by_subject.subject_id)) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }
    await deps.scheduleStore.deleteSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    return c.json({}, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listSchedulesRoute, listHandler);
  router.openapi(listScheduleRunsRoute, listRunsHandler);
  router.openapi(createScheduleRunRoute, createScheduleRunHandler);
  router.openapi(createScheduleRoute, createHandler);
  router.openapi(getScheduleRoute, getHandler);
  router.openapi(putScheduleRoute, putHandler);
  router.openapi(deleteScheduleRoute, deleteHandler);
  return router;
}
