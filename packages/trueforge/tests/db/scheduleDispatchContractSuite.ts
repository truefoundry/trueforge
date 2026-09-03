import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';

import { dispatchScheduledRuns } from '../../src/controller/scheduleDispatch';
import type { IAgentStore } from '../../src/db/agentStore';
import {
  type IScheduleStore,
  type ScheduleDispatchItem,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from '../../src/db/scheduleStore';
import type { WithTransaction } from '../../src/db/transaction';
import { nextTriggerAfter } from '../../src/runtime/cron';
import { ScheduleManifestSchema, type ScheduleManifest } from '../../src/schemas/schedule';

const TENANT = 'default';
/** Schedule creator. Every advanced run must be attributed to this identity. */
const USER = 'tester';
/** Distinct from {@link USER}, so `triggered_by` assertions cannot pass by aliasing. */
const OTHER_ACTOR = 'someone-else';
const CRON = '0 * * * *';
/**
 * Triggers every minute. Used where a past `scheduled_for` must produce a DIFFERENT
 * next trigger time than `now` does — an hourly cron aliases the two unless the seeded time
 * happens to straddle an hour boundary, which makes the assertion flaky rather
 * than wrong. The one-hour minimum interval is an API-layer rule, not a store one.
 */
const MINUTELY_CRON = '* * * * *';
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

/** Next trigger time may land on either side of an hour boundary between seed and assert. */
function expectNextTriggerIso(actual: string | undefined, fromMs: number, toMs: number): void {
  const candidates = new Set([
    nextTriggerAfter({ cron: CRON, timezone: TIMEZONE, from: new Date(fromMs) }).toISOString(),
    nextTriggerAfter({ cron: CRON, timezone: TIMEZONE, from: new Date(toMs) }).toISOString(),
  ]);
  expect(actual !== undefined && candidates.has(actual)).toBe(true);
}

export function runScheduleDispatchContractSuite<TTransaction>(deps: {
  getAgentStore: () => IAgentStore;
  getScheduleStore: () => IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}): void {
  const logger = createLogger({ silent: true });
  let seq = 0;

  async function seedAgent(): Promise<string> {
    seq += 1;
    const agent = await deps.getAgentStore().createAgent({
      tenant_id: TENANT,
      name: `agent-${String(Date.now())}-${String(seq)}`,
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'Be helpful.',
      }),
      external_id: null,
    });
    return agent.name;
  }

  async function scheduledRunsFor(scheduleId: string): Promise<ScheduleRunRecord[]> {
    const found = await deps.getScheduleStore().listScheduledRuns({ limit: 100, until: new Date() });
    return found.filter(run => run.schedule_id === scheduleId);
  }

  /**
   * Advances any run left ready by an earlier test.
   */
  async function drainScheduledRuns(): Promise<void> {
    await dispatchScheduledRuns({
      store: deps.getScheduleStore(),
      withTransaction: deps.withTransaction,
      onTriggered: () => undefined,
      logger,
    });
  }

  async function seedSchedule(params: {
    status?: 'active' | 'paused';
    scheduledFor: Date;
    cron?: string;
    triggeredBy?: string;
  }): Promise<{ schedule: ScheduleRecord; run: ScheduleRunRecord }> {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const status = params.status ?? 'active';
    const cron = params.cron ?? CRON;
    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
      name: `sched-${String(Date.now())}-${String(seq)}`,
      manifest: manifest({ status, cron }),
      created_by: USER,
      // Far enough ahead so that it doesnt clash with actual test.
      runFrom: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000),
    });
    // Mark the auto-added pending run failed so the exact run can be added.
    if (pendingRun !== undefined) {
      await store.updateRunStatus({ tenant_id: TENANT, id: pendingRun.id, status: 'failed' });
    }
    const run = await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: `test-${String(Date.now())}-${String(seq)}`,
      scheduled_for: params.scheduledFor,
      status: 'scheduled',
      triggered_by: params.triggeredBy ?? USER,
    });
    return { schedule, run };
  }

  it('triggers a scheduled run and adds a next scheduled run', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({
      scheduledFor: pastScheduledFor,
      triggeredBy: OTHER_ACTOR,
    });
    const triggered: ScheduleDispatchItem[] = [];
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: item => {
        expect(item.run.status).toBe('scheduled');
        triggered.push(item);
      },
      logger,
    });
    const after = Date.now();

    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.run.id).toBe(run.id);
    expect(triggered[0]?.schedule.id).toBe(schedule.id);

    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'triggered',
      }),
    );
    expect(typeof updated?.triggered_at).toBe('string');

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
        triggered_by: USER,
      }),
    );
    expect(next?.id).not.toBe(run.id);
    expectNextTriggerIso(next?.scheduled_for, before, after);
    // Whatever the cron, the next run is never already ready to run.
    expect(Date.parse(next?.scheduled_for ?? '')).toBeGreaterThan(before);
  });

  it('advances from now, not from the time it just ran (no backfill)', async () => {
    const store = deps.getScheduleStore();
    const staleSlot = new Date(Date.now() - 30 * 60_000);
    const { schedule, run } = await seedSchedule({
      scheduledFor: staleSlot,
      cron: MINUTELY_CRON,
    });
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: () => undefined,
      logger,
    });
    const after = Date.now();

    expect(result).toEqual({ dispatched: 1, failed: 0 });

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next?.id).not.toBe(run.id);
    expect(Date.parse(next?.scheduled_for ?? '')).toBeGreaterThan(before);
    const candidates = new Set([
      nextTriggerAfter({ cron: MINUTELY_CRON, timezone: TIMEZONE, from: new Date(before) }).toISOString(),
      nextTriggerAfter({ cron: MINUTELY_CRON, timezone: TIMEZONE, from: new Date(after) }).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && candidates.has(next.scheduled_for)).toBe(true);
  });

  it('marks the run failed when on error; the next scheduled run is added', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: () => {
        throw new Error('executor unavailable');
      },
      logger,
    });

    expect(result).toEqual({ dispatched: 0, failed: 1 });

    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(
      expect.objectContaining({
        id: run.id,
        status: 'failed',
      }),
    );

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    expect(next?.id).not.toBe(run.id);
  });

  it('runs an existing row on a paused schedule, but adds no next run', async () => {
    const store = deps.getScheduleStore();
    const { schedule, run } = await seedSchedule({
      status: 'paused',
      scheduledFor: new Date(Date.now() - 60_000),
    });
    const triggered: ScheduleDispatchItem[] = [];

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: item => {
        triggered.push(item);
      },
      logger,
    });

    // `paused` withholds the advance; it never cancels a row that already exists.
    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(triggered.map(item => item.run.id)).toEqual([run.id]);
    const updated = await store.getRun({ tenant_id: TENANT, id: run.id });
    expect(updated).toEqual(expect.objectContaining({ id: run.id, status: 'triggered' }));
    expect(typeof updated?.triggered_at).toBe('string');
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('adds the next run from the cron when cron is updated', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    const newCron = '15 * * * *';
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      store,
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

    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toBeUndefined();

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    const newCandidates = new Set([
      nextTriggerAfter({ cron: newCron, timezone: TIMEZONE, from: new Date(before) }).toISOString(),
      nextTriggerAfter({ cron: newCron, timezone: TIMEZONE, from: new Date(after) }).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && newCandidates.has(next.scheduled_for)).toBe(true);

    const oldCandidates = new Set([
      nextTriggerAfter({ cron: CRON, timezone: TIMEZONE, from: new Date(before) }).toISOString(),
      nextTriggerAfter({ cron: CRON, timezone: TIMEZONE, from: new Date(after) }).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && oldCandidates.has(next.scheduled_for)).toBe(false);
  });

  it('pause in middle drops the pending run; a later pass does not add another', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });

    const first = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: async item => {
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

    expect(first).toEqual({ dispatched: 1, failed: 0 });
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toBeUndefined();
    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id })).toEqual(
      expect.objectContaining({ id: schedule.id, status: 'paused' }),
    );
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
    expect(await scheduledRunsFor(schedule.id)).toEqual([]);

    const second = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: () => {
        throw new Error('paused schedule must not hand off');
      },
      logger,
    });

    expect(second).toEqual({ dispatched: 0, failed: 0 });
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
    expect(await scheduledRunsFor(schedule.id)).toEqual([]);
  });

  it("processes a whole batch oldest first, isolating one run's failure from the rest", async () => {
    const store = deps.getScheduleStore();
    // This test asserts on the pass result, so nothing else may be ready first.
    await drainScheduledRuns();
    expect(await store.listScheduledRuns({ limit: 100, until: new Date() })).toEqual([]);

    const now = Date.now();
    const thrower = await seedSchedule({ scheduledFor: new Date(now - 50 * 60_000) });
    const healthy = await seedSchedule({ scheduledFor: new Date(now - 5 * 60_000) });
    const handedOff: string[] = [];
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: item => {
        handedOff.push(item.run.id);
        if (item.run.id === thrower.run.id) {
          throw new Error('executor unavailable');
        }
      },
      logger,
    });

    expect(result).toEqual({ dispatched: 1, failed: 1 });
    expect(handedOff).toEqual([thrower.run.id, healthy.run.id]);

    expect(await store.getRun({ tenant_id: TENANT, id: thrower.run.id })).toEqual(
      expect.objectContaining({ status: 'failed', triggered_at: null }),
    );
    const healthyUpdated = await store.getRun({ tenant_id: TENANT, id: healthy.run.id });
    expect(healthyUpdated).toEqual(expect.objectContaining({ status: 'triggered' }));
    expect(typeof healthyUpdated?.triggered_at).toBe('string');

    // Every schedule advances, whatever its run's outcome, and never onto a past time.
    for (const seeded of [thrower, healthy]) {
      const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: seeded.schedule.id });
      expect(next?.id).not.toBe(seeded.run.id);
      expect(Date.parse(next?.scheduled_for ?? '')).toBeGreaterThan(before);
      expect(await scheduledRunsFor(seeded.schedule.id)).toEqual([]);
    }
  });
}
