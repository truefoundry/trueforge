/**
 * Schedules API (mounted at /api/v1/schedules).xw
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { UserContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import { cronRunName, type IScheduleStore, type ScheduleRecord } from '../db/scheduleStore';
import type { WithTransaction } from '../db/transaction';
import {
  createScheduleRoute,
  deleteScheduleRoute,
  getScheduleRoute,
  listSchedulesRoute,
  putScheduleRoute,
} from '../routes/scheduleRoutes';
import { minIntervalSeconds, nextFireAfter } from '../runtime/cron';
import {
  InvalidCronError,
  SCHEDULE_MIN_INTERVAL_SECONDS,
  type ConfiguredSchedule,
  type ScheduleManifest,
} from '../schemas/schedule';
import { TENANT_ID } from './sessions';

export interface SchedulesRouterDeps<TTransaction> {
  scheduleStore: IScheduleStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveUserContext: (c: Context) => UserContext;
}

function toWireSchedule(record: ScheduleRecord): ConfiguredSchedule {
  return {
    id: record.id,
    agent_id: record.agent_id,
    name: record.name,
    manifest: record.manifest,
    status: record.status,
    created_by: record.created_by,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function validateManifest(
  manifest: Pick<ScheduleManifest, 'cron' | 'timezone'>,
  from: Date = new Date(),
): void {
  // Reject if the cron has no upcoming fire (impossible / exhausted calendar).
  // 5-field cron has no year, so a valid expression always recurs — no one-shot check.
  try {
    nextFireAfter(manifest.cron, manifest.timezone, from);
  } catch (error) {
    throw new InvalidCronError(
      `Cron expression "${manifest.cron}" has no next fire time in ${manifest.timezone}`,
      { cause: error },
    );
  }

  // Reject expressions that fire < SCHEDULE_MIN_INTERVAL_SECONDS seconds apart.
  let tightest: number;
  try {
    tightest = minIntervalSeconds(manifest, from);
  } catch (error) {
    throw new InvalidCronError(
      `Cron expression "${manifest.cron}" has no next fire time in ${manifest.timezone}`,
      { cause: error },
    );
  }

  if (tightest < SCHEDULE_MIN_INTERVAL_SECONDS) {
    throw new InvalidCronError(
      `Cron expression "${manifest.cron}" fires every ${String(tightest)}s; the minimum interval is ${String(
        SCHEDULE_MIN_INTERVAL_SECONDS,
      )}s`,
    );
  }
}

export function createSchedulesRouter<TTransaction>(deps: SchedulesRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listSchedulesRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('query');
    const records = await deps.scheduleStore.listSchedules({ tenant_id: TENANT_ID, agent_id: agentId });
    return c.json({ data: records.map(toWireSchedule) }, 200);
  };

  const createHandler: RouteHandler<typeof createScheduleRoute> = async c => {
    const body = c.req.valid('json');
    const user = deps.resolveUserContext(c);

    validateManifest(body.manifest);

    const agent = await deps.agentStore.getAgent({ tenant_id: TENANT_ID, id: body.agent_id });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${body.agent_id}` } }, 400);
    }

    const record = await deps.withTransaction(async transaction => {
      const created = await deps.scheduleStore.createSchedule(
        {
          tenant_id: TENANT_ID,
          agent_id: body.agent_id,
          name: body.name,
          manifest: body.manifest,
          created_by: user.userRef,
        },
        transaction,
      );
      // A schedule created paused has nothing to arm; the first PUT that activates
      // it arms the slot from that moment.
      if (created.status === 'active') {
        const nextFire = nextFireAfter(created.manifest.cron, created.manifest.timezone, new Date());
        await deps.scheduleStore.createRun(
          {
            tenant_id: created.tenant_id,
            schedule_id: created.id,
            name: cronRunName(nextFire),
            scheduled_for: nextFire,
            status: 'scheduled',
            triggered_by: created.created_by,
          },
          transaction,
        );
      }
      return created;
    });

    return c.json({ data: toWireSchedule(record) }, 201);
  };

  const getHandler: RouteHandler<typeof getScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const record = await deps.scheduleStore.getSchedule({ tenant_id: TENANT_ID, id: scheduleId });
    if (record === undefined) {
      return c.json({ error: { message: `Schedule not found: ${scheduleId}` } }, 404);
    }
    return c.json({ data: toWireSchedule(record) }, 200);
  };

  const putHandler: RouteHandler<typeof putScheduleRoute> = async c => {
    const { schedule_id: scheduleId } = c.req.valid('param');
    const body = c.req.valid('json');

    validateManifest(body.manifest);

    const record = await deps.withTransaction(async transaction => {
      const updated = await deps.scheduleStore.updateSchedule(
        { tenant_id: TENANT_ID, id: scheduleId, name: body.name, manifest: body.manifest },
        transaction,
      );
      if (updated === undefined) {
        return undefined;
      }
      await deps.scheduleStore.deleteScheduledRun({ tenant_id: TENANT_ID, id: scheduleId }, transaction);
      if (updated.status === 'active') {
        const nextFire = nextFireAfter(updated.manifest.cron, updated.manifest.timezone, new Date());
        await deps.scheduleStore.createRun(
          {
            tenant_id: updated.tenant_id,
            schedule_id: updated.id,
            name: cronRunName(nextFire),
            scheduled_for: nextFire,
            status: 'scheduled',
            triggered_by: updated.created_by,
          },
          transaction,
        );
      }
      return updated;
    });

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
