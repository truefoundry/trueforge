/**
 * Schedules API (mounted at /api/v1/schedules).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { UserContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import { ScheduleRunConflictError, type IScheduleStore, type ScheduleRecord } from '../db/scheduleStore';
import type { WithTransaction } from '../db/transaction';
import {
  createScheduleRoute,
  deleteScheduleRoute,
  getScheduleRoute,
  listSchedulesRoute,
  putScheduleRoute,
} from '../routes/scheduleRoutes';
import { minIntervalSeconds, nextTriggerAfter } from '../runtime/cron';
import {
  InvalidCronError,
  SCHEDULE_MIN_INTERVAL_SECONDS,
  type Schedule,
  type ScheduleManifest,
} from '../schemas/schedule';
import { TENANT_ID } from './sessions';

export interface SchedulesRouterDeps<TTransaction> {
  scheduleStore: IScheduleStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveUserContext: (c: Context) => UserContext;
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

export function createSchedulesRouter<TTransaction>(deps: SchedulesRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listSchedulesRoute> = async c => {
    const { agent_name: agentName } = c.req.valid('query');
    const records = await deps.scheduleStore.listSchedules({
      tenant_id: TENANT_ID,
      agent_name: agentName,
    });
    return c.json({ data: records.map(toWireSchedule) }, 200);
  };

  const createHandler: RouteHandler<typeof createScheduleRoute> = async c => {
    const body = c.req.valid('json');
    const user = deps.resolveUserContext(c);

    validateManifest(body.manifest);

    const agent = await deps.agentStore.getAgent({ tenant_id: TENANT_ID, name: body.agent_name });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${body.agent_name}` } }, 400);
    }

    let record: ScheduleRecord;
    try {
      record = await deps.withTransaction(async transaction => {
        const { schedule } = await deps.scheduleStore.createScheduleAndRun(
          {
            tenant_id: TENANT_ID,
            agent_name: agent.name,
            name: body.name,
            manifest: body.manifest,
            created_by: user.userRef,
            runFrom: new Date(),
          },
          transaction,
        );
        return schedule;
      });
    } catch (error) {
      if (error instanceof ScheduleRunConflictError) {
        return c.json({ error: { message: `${error.message}. Retry the request.` } }, 409);
      }
      throw error;
    }

    return c.json({ data: toWireSchedule(record) }, 201);
  };

  const getHandler: RouteHandler<typeof getScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const record = await deps.scheduleStore.getSchedule({ tenant_id: TENANT_ID, id: scheduleId, forUpdate: false });
    if (record === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
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
   * a different schedule. `name` is editable (display only; not unique).
   */
  const putHandler: RouteHandler<typeof putScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const body = c.req.valid('json');

    validateManifest(body.manifest);

    let record: ScheduleRecord | undefined;
    try {
      record = await deps.withTransaction(async transaction => {
        const result = await deps.scheduleStore.updateScheduleAndRun(
          {
            tenant_id: TENANT_ID,
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
    await deps.scheduleStore.deleteSchedule({ tenant_id: TENANT_ID, id: scheduleId });
    return c.json({}, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listSchedulesRoute, listHandler);
  router.openapi(createScheduleRoute, createHandler);
  router.openapi(getScheduleRoute, getHandler);
  router.openapi(putScheduleRoute, putHandler);
  router.openapi(deleteScheduleRoute, deleteHandler);
  return router;
}
