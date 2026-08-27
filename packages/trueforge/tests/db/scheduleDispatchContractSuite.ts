import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';

import { dispatchScheduledRuns } from '../../src/controller/scheduleDispatch';
import type { IAgentStore } from '../../src/db/agentStore';
import {
  cronRunName,
  type ScheduleDispatchItem,
  type IScheduleStore,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from '../../src/db/scheduleStore';
import type { WithTransaction } from '../../src/db/transaction';
import { nextFireAfter } from '../../src/runtime/cron';
import { SCHEDULE_MAX_LATENESS_SECONDS, ScheduleManifestSchema, type ScheduleManifest } from '../../src/schemas/schedule';

const TENANT = 'default';
const USER = 'tester';
const CRON = '0 * * * *';
const TIMEZONE = 'UTC';

function manifest(overrides: Partial<ScheduleManifest> = {}): ScheduleManifest {
  return ScheduleManifestSchema.parse({
    task: 'Say hello',
    cron: CRON,
    timezone: TIMEZONE,
    status: 'active',
    ...overrides,
  });
}

/** Next fire may land on either side of an hour boundary between seed and assert. */
function expectNextFireIso(actual: string | undefined, fromMs: number, toMs: number): void {
  const candidates = new Set([
    nextFireAfter(CRON, TIMEZONE, new Date(fromMs)).toISOString(),
    nextFireAfter(CRON, TIMEZONE, new Date(toMs)).toISOString(),
  ]);
  expect(actual !== undefined && candidates.has(actual)).toBe(true);
}

export function runScheduleDispatchContractSuite<TTransaction>(deps: {
  getAgentStore: () => IAgentStore;
  getScheduleStore: () => IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}): void {
  const logger = createLogger({ silent: true });

  async function seedAgent(): Promise<string> {
    const agent = await deps.getAgentStore().createAgent({
      tenant_id: TENANT,
      name: `agent-${String(Date.now())}`,
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'Be helpful.',
      }),
    });
    return agent.id;
  }

  async function seedSchedule(params: {
    status?: 'active' | 'paused';
    scheduledFor: Date;
  }): Promise<{ schedule: ScheduleRecord; run: ScheduleRunRecord }> {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const status = params.status ?? 'active';
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_id: agentId,
      name: `sched-${String(Date.now())}`,
      manifest: manifest({ status }),
      created_by: USER,
      runFrom: new Date(),
    });
    // Replace any auto-added pending slot with the exact scheduled run under test.
    await store.deleteScheduledRun({ tenant_id: TENANT, id: schedule.id });
    const run = await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: cronRunName(params.scheduledFor),
      scheduled_for: params.scheduledFor,
      status: 'scheduled',
      triggered_by: USER,
    });
    return { schedule, run };
  }

  it('triggers a scheduled run, hands it off, and adds a next scheduled run', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    const triggered: ScheduleDispatchItem[] = [];
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: item => {
        expect(item.run.status).toBe('scheduled');
        triggered.push(item);
      },
      logger,
    });
    const after = Date.now();

    expect(result).toEqual({ dispatched: 1, missed: 0 });
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.run.id).toBe(run.id);
    expect(triggered[0]?.schedule.id).toBe(schedule.id);

    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'triggered',
        triggered_at: expect.any(String),
      }),
    );

    const next = await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
        triggered_by: USER,
      }),
    );
    expect(next?.id).not.toBe(run.id);
    expectNextFireIso(next?.scheduled_for, before, after);
  });

  it('marks a run missed when it is later than the lateness bound and adds a next scheduled run', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - (SCHEDULE_MAX_LATENESS_SECONDS + 1) * 1000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    const triggered: ScheduleDispatchItem[] = [];
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: item => {
        triggered.push(item);
      },
      logger,
    });
    const after = Date.now();

    expect(result).toEqual({ dispatched: 0, missed: 1 });
    expect(triggered).toHaveLength(0);

    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'missed',
        triggered_at: null,
      }),
    );

    const next = await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    expect(next?.id).not.toBe(run.id);
    expectNextFireIso(next?.scheduled_for, before, after);
  });

  it('marks the run failed when onTriggered throws; the next scheduled run stays added', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });

    const result = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: () => {
        throw new Error('executor unavailable');
      },
      logger,
    });

    expect(result).toEqual({ dispatched: 0, missed: 0 });

    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'failed',
      }),
    );

    const next = await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    expect(next?.id).not.toBe(run.id);
  });

  it('adds the next run from the cron updated during onTriggered', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    // Distinct from the seeded hourly `:00` cron so the next slot cannot alias.
    const newCron = '15 * * * *';
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: async item => {
        const updated = await store.updateScheduleAndRun({
          tenant_id: TENANT,
          id: item.schedule.id,
          name: item.schedule.name,
          manifest: manifest({ cron: newCron }),
          runFrom: new Date(),
        });
        expect(updated).toBeDefined();
      },
      logger,
    });
    const after = Date.now();

    expect(result).toEqual({ dispatched: 1, missed: 0 });
    // Manifest put deletes the in-flight pending row while finishing.
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toBeUndefined();

    const next = await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    const newCandidates = new Set([
      nextFireAfter(newCron, TIMEZONE, new Date(before)).toISOString(),
      nextFireAfter(newCron, TIMEZONE, new Date(after)).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && newCandidates.has(next.scheduled_for)).toBe(true);

    const oldCandidates = new Set([
      nextFireAfter(CRON, TIMEZONE, new Date(before)).toISOString(),
      nextFireAfter(CRON, TIMEZONE, new Date(after)).toISOString(),
    ]);
    expect(oldCandidates.has(next!.scheduled_for)).toBe(false);
  });

  it('pause in onTriggered drops the pending run; a later pass does not add another', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });

    const first = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: async item => {
        // Hand-off still sees `scheduled`; pause deletes that pending row before commit.
        expect(item.run.status).toBe('scheduled');
        const paused = await store.updateScheduleAndRun({
          tenant_id: TENANT,
          id: item.schedule.id,
          name: item.schedule.name,
          manifest: manifest({ status: 'paused' }),
          runFrom: new Date(),
        });
        expect(paused).toBeDefined();
      },
      logger,
    });

    // Hand-off succeeded; pause may still have dropped the row before finish.
    expect(first).toEqual({ dispatched: 1, missed: 0 });
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toBeUndefined();
    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id })).toEqual(
      expect.objectContaining({ id: schedule.id, status: 'paused' }),
    );
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
    expect(await store.findScheduledRuns({ limit: 20 })).toEqual([]);

    const second = await dispatchScheduledRuns({
      scheduleStore: store,
      withTransaction: deps.withTransaction,
      onTriggered: () => {
        throw new Error('paused schedule must not hand off');
      },
      logger,
    });

    expect(second).toEqual({ dispatched: 0, missed: 0 });
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
    expect(await store.findScheduledRuns({ limit: 20 })).toEqual([]);
  });
}
