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
import {
  SCHEDULE_MAX_LATENESS_SECONDS,
  ScheduleManifestSchema,
  type ScheduleManifest,
} from '../../src/schemas/schedule';

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
    nextTriggerAfter(CRON, TIMEZONE, new Date(fromMs)).toISOString(),
    nextTriggerAfter(CRON, TIMEZONE, new Date(toMs)).toISOString(),
  ]);
  expect(actual !== undefined && candidates.has(actual)).toBe(true);
}

export function runScheduleDispatchContractSuite<TTransaction>(deps: {
  getAgentStore: () => IAgentStore;
  getScheduleStore: () => IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}): void {
  const logger = createLogger({ silent: true });
  /** Agent names are unique per tenant, and `Date.now()` alone collides in a tight loop. */
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
    });
    return agent.name;
  }

  /**
   * Runs of one schedule whose `scheduled_for` has passed.
   *
   * `listScheduledRuns` is unscoped by design — dispatch sweeps every schedule — so
   * a test must never assert on its raw result, or it inherits whatever pending rows
   * its neighbours left behind.
   */
  async function scheduledRunsFor(scheduleId: string): Promise<ScheduleRunRecord[]> {
    const found = await deps.getScheduleStore().listScheduledRuns({ limit: 100, until: new Date() });
    return found.filter(run => run.schedule_id === scheduleId);
  }

  /**
   * Advances any run left ready by an earlier test.
   *
   * `dispatchScheduledRuns` sweeps every schedule, so a test that asserts on the
   * pass RESULT (counters, hand-off order) — rather than on specific rows — must
   * start from a database where nothing else is ready to run.
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
    /** Actor on the seeded run; defaults to the creator. */
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
    // Mark the auto-added pending run missed so the exact run can be added.
    if (pendingRun !== undefined) {
      await store.updateRunStatus({ tenant_id: TENANT, id: pendingRun.id, status: 'missed' });
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

  // Tests run in the order dispatch itself reaches these states: the happy path
  // first, then each failure the loop can hit as it walks a run (too late -> hand-off
  // threw), then the cases where the advance is withheld or raced, and finally the
  // whole batch together.

  it('triggers a scheduled run, hands it off, and adds a next scheduled run', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    // The run under test carries a different actor, so asserting the ADVANCED row is
    // `schedule.created_by` cannot pass by coincidence.
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

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
        // The schedule's creator, not whoever the previous run was attributed to.
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
    // Half an hour late: still inside the lateness bound, so this run triggers. With a
    // minute-level cron, advancing from `scheduled_for` would land ~29 minutes in the past,
    // while advancing from NOW lands in the next minute — the two cannot alias.
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

    expect(result).toEqual({ dispatched: 1, missed: 0 });

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next?.id).not.toBe(run.id);
    // The intervening 30 minutes of triggers are skipped outright, never replayed.
    expect(Date.parse(next?.scheduled_for ?? '')).toBeGreaterThan(before);
    const candidates = new Set([
      nextTriggerAfter(MINUTELY_CRON, TIMEZONE, new Date(before)).toISOString(),
      nextTriggerAfter(MINUTELY_CRON, TIMEZONE, new Date(after)).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && candidates.has(next.scheduled_for)).toBe(true);
  });

  it('marks a run missed when it is later than the lateness bound and adds a next scheduled run', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - (SCHEDULE_MAX_LATENESS_SECONDS + 1) * 1000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    const triggered: ScheduleDispatchItem[] = [];
    const before = Date.now();

    const result = await dispatchScheduledRuns({
      store,
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

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    expect(next?.id).not.toBe(run.id);
    expectNextTriggerIso(next?.scheduled_for, before, after);
  });

  it('marks the run failed when onTriggered throws; the next scheduled run stays added', async () => {
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

    expect(result).toEqual({ dispatched: 0, missed: 0 });

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
    expect(result).toEqual({ dispatched: 1, missed: 0 });
    expect(triggered.map(item => item.run.id)).toEqual([run.id]);
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toEqual(
      expect.objectContaining({ id: run.id, status: 'triggered', triggered_at: expect.any(String) }),
    );
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('records a late row on a paused schedule as missed, leaving no gap in history', async () => {
    const store = deps.getScheduleStore();
    const { schedule, run } = await seedSchedule({
      status: 'paused',
      scheduledFor: new Date(Date.now() - (SCHEDULE_MAX_LATENESS_SECONDS + 1) * 1000),
    });

    const result = await dispatchScheduledRuns({
      store,
      withTransaction: deps.withTransaction,
      onTriggered: () => {
        throw new Error('a run past the lateness bound must not hand off');
      },
      logger,
    });

    expect(result).toEqual({ dispatched: 0, missed: 1 });
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toEqual(
      expect.objectContaining({ id: run.id, status: 'missed', triggered_at: null }),
    );
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('adds the next run from the cron updated during onTriggered', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });
    // Distinct from the seeded hourly `:00` cron so the next trigger time cannot alias.
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

    expect(result).toEqual({ dispatched: 1, missed: 0 });
    // Manifest put deletes the in-flight pending row while finishing.
    expect(await store.getRun({ tenant_id: TENANT, id: run.id })).toBeUndefined();

    const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id });
    expect(next).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
      }),
    );
    const newCandidates = new Set([
      nextTriggerAfter(newCron, TIMEZONE, new Date(before)).toISOString(),
      nextTriggerAfter(newCron, TIMEZONE, new Date(after)).toISOString(),
    ]);
    expect(next?.scheduled_for !== undefined && newCandidates.has(next.scheduled_for)).toBe(true);

    const oldCandidates = new Set([
      nextTriggerAfter(CRON, TIMEZONE, new Date(before)).toISOString(),
      nextTriggerAfter(CRON, TIMEZONE, new Date(after)).toISOString(),
    ]);
    expect(oldCandidates.has(next!.scheduled_for)).toBe(false);
  });

  it('pause in onTriggered drops the pending run; a later pass does not add another', async () => {
    const store = deps.getScheduleStore();
    const pastScheduledFor = new Date(Date.now() - 60_000);
    const { schedule, run } = await seedSchedule({ scheduledFor: pastScheduledFor });

    const first = await dispatchScheduledRuns({
      store,
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
    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id, forUpdate: false })).toEqual(
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

    expect(second).toEqual({ dispatched: 0, missed: 0 });
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
    expect(await scheduledRunsFor(schedule.id)).toEqual([]);
  });

  it("processes a whole batch oldest first, isolating one run's failure from the rest", async () => {
    const store = deps.getScheduleStore();
    // This test asserts on the pass result, so nothing else may be ready first.
    await drainScheduledRuns();
    expect(await store.listScheduledRuns({ limit: 100, until: new Date() })).toEqual([]);

    const now = Date.now();
    // Ordered by `scheduled_for` ascending, which is the order dispatch must use.
    // The thrower sits BEFORE the healthy run on purpose: if one failure aborted the
    // pass, `healthy` would never be reached and its assertions would fail.
    const late = await seedSchedule({ scheduledFor: new Date(now - 70 * 60_000) });
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

    // One triggered, one missed, one failed — and `failed` is deliberately uncounted.
    expect(result).toEqual({ dispatched: 1, missed: 1 });
    // `late` is past the lateness bound so it never reaches hand-off; the other two do,
    // oldest first.
    expect(handedOff).toEqual([thrower.run.id, healthy.run.id]);

    expect(await store.getRun({ tenant_id: TENANT, id: late.run.id })).toEqual(
      expect.objectContaining({ status: 'missed', triggered_at: null }),
    );
    expect(await store.getRun({ tenant_id: TENANT, id: thrower.run.id })).toEqual(
      expect.objectContaining({ status: 'failed', triggered_at: null }),
    );
    expect(await store.getRun({ tenant_id: TENANT, id: healthy.run.id })).toEqual(
      expect.objectContaining({ status: 'triggered', triggered_at: expect.any(String) }),
    );

    // Every schedule advances, whatever its run's outcome, and never onto a past time.
    for (const seeded of [late, thrower, healthy]) {
      const next = await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: seeded.schedule.id });
      expect(next?.id).not.toBe(seeded.run.id);
      expect(Date.parse(next?.scheduled_for ?? '')).toBeGreaterThan(before);
      expect(await scheduledRunsFor(seeded.schedule.id)).toEqual([]);
    }
  });
}
