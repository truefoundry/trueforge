/**
 * Schedules API (mounted at /api/v1/schedules).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError, type Sessions } from '@truefoundry/trueforge-core/agent-session';
import type { RequestContext, ResolveRequestContext } from '../auth/identity';
import { ScheduleAgentNotFoundError, startScheduleRun } from '../controller/scheduleDispatch';
import type { IAgentStore } from '../db/agentStore';
import {
  manualRunName,
  ScheduleNameConflictError,
  ScheduleRunConflictError,
  type IScheduleStore,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from '../db/scheduleStore';
import type { WithTransaction } from '../db/transaction';
import {
  createScheduleRoute,
  createScheduleRunRoute,
  deleteScheduleRoute,
  getScheduleRoute,
  listScheduleRunsRoute,
  listSchedulesRoute,
  putScheduleRoute,
} from '../routes/scheduleRoutes';
import { minIntervalSeconds, nextTriggerAfter } from '../runtime/cron';
import {
  InvalidCronError,
  SCHEDULE_MIN_INTERVAL_SECONDS,
  type Schedule,
  type ScheduleManifest,
  type ScheduleRun,
} from '../schemas/schedule';
import { getTurnExecutionError, startTurnInProcess, type BeginTurnExecutionDeps } from './turns';

export interface SchedulesRouterDeps<TTransaction> {
  scheduleStore: IScheduleStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  sessions: Sessions;
  turnDeps: BeginTurnExecutionDeps;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function toWireSchedule(record: ScheduleRecord): Schedule {
  return {
    id: record.id,
    agent_name: record.agent_name,
    name: record.name,
    manifest: record.manifest,
    created_by: record.created_by,
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
    triggered_by: record.triggered_by,
    triggered_at: record.triggered_at,
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

/**
 * A schedule is visible to its creator, and to any admin.
 *
 * Standalone auth stamps `is_admin: true` on the sole identity, which already
 * owns everything it created — so admin bypass is a no-op there.
 */
function canAccessSchedule(requestContext: Pick<RequestContext, 'is_admin' | 'subject'>, createdBy: string): boolean {
  return requestContext.is_admin || requestContext.subject.id === createdBy;
}

export function createSchedulesRouter<TTransaction>(deps: SchedulesRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listSchedulesRoute> = async c => {
    const { agent_names: agentNames, limit, page_token: pageToken } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    // Admins see every schedule; a regular user is scoped to their own via the
    // store's `created_by` filter (never a client-supplied param).
    try {
      const { data, pagination } = await deps.scheduleStore.listSchedules({
        tenant_id: requestContext.tenant_id,
        limit,
        page_token: pageToken,
        agent_names: agentNames,
        created_by: requestContext.is_admin ? undefined : requestContext.subject.id,
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
    const requestContext = deps.resolveRequestContext(c);
    const schedule = await deps.scheduleStore.getSchedule({
      tenant_id: requestContext.tenant_id,
      id: scheduleId,
    });
    if (schedule === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    if (!canAccessSchedule(requestContext, schedule.created_by)) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
    }
    const records = await deps.scheduleStore.listRuns({
      tenant_id: requestContext.tenant_id,
      schedule_id: scheduleId,
    });
    return c.json({ data: records.map(toWireScheduleRun) }, 200);
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
    if (!canAccessSchedule(requestContext, schedule.created_by)) {
      return c.json({ error: { message: FORBIDDEN_SCHEDULE_ACCESS } }, 403);
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
        triggered_by: requestContext.subject.id,
        triggered_at: now,
      });
    } catch (error) {
      if (error instanceof ScheduleRunConflictError) {
        return c.json({ error: { message: `${error.message}. Retry the request.` } }, 409);
      }
      throw error;
    }

    try {
      await startScheduleRun({
        item: { run, schedule },
        sessions: deps.sessions,
        agentStore: deps.agentStore,
        startTurn: async turnParams => {
          await startTurnInProcess({ ...turnParams, deps: deps.turnDeps });
        },
      });
    } catch (error) {
      await deps.scheduleStore.updateRunStatus({
        tenant_id: requestContext.tenant_id,
        id: run.id,
        status: 'failed',
      });

      if (error instanceof ScheduleAgentNotFoundError) {
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

    const agent = await deps.agentStore.getAgent({
      tenant_id: requestContext.tenant_id,
      name: body.agent_name,
    });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${body.agent_name}` } }, 400);
    }

    let record: ScheduleRecord;
    try {
      record = await deps.withTransaction(async transaction => {
        const { schedule } = await deps.scheduleStore.createScheduleAndRun(
          {
            tenant_id: requestContext.tenant_id,
            agent_name: agent.name,
            name: body.name,
            manifest: body.manifest,
            created_by: requestContext.subject.id,
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
    if (!canAccessSchedule(requestContext, record.created_by)) {
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
    if (!canAccessSchedule(requestContext, existing.created_by)) {
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
    if (!canAccessSchedule(requestContext, record.created_by)) {
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
