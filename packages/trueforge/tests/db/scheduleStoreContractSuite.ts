import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { IAgentStore } from '../../src/db/agentStore';
import { cronRunName, type IScheduleStore } from '../../src/db/scheduleStore';
import { nextTriggerAfter } from '../../src/runtime/cron';
import { ScheduleManifestSchema, type ScheduleManifest } from '../../src/schemas/schedule';

const TENANT = 'default';
const USER = 'tester';

function manifest(overrides: Partial<ScheduleManifest> = {}): ScheduleManifest {
  return ScheduleManifestSchema.parse({
    task: 'Say hello',
    cron: '0 13 * * 1-5',
    timezone: 'UTC',
    status: 'active',
    ...overrides,
  });
}

export function runScheduleStoreContractSuite(deps: {
  getAgentStore: () => IAgentStore;
  getScheduleStore: () => IScheduleStore;
}): void {
  async function seedAgent(): Promise<{ id: string; name: string }> {
    const agent = await deps.getAgentStore().createAgent({
      tenant_id: TENANT,
      name: `agent-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'Be helpful.',
      }),
    });
    return { id: agent.id, name: agent.name };
  }

  it('create active schedule adds a pending run for the next cron trigger', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const runFrom = new Date('2026-08-27T10:00:00.000Z');
    const m = manifest({ cron: '0 13 * * *', timezone: 'UTC' });

    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'daily',
      manifest: m,
      created_by: USER,
      runFrom,
    });

    expect(pendingRun).toEqual(
      expect.objectContaining({
        schedule_id: schedule.id,
        status: 'scheduled',
        triggered_by: USER,
        scheduled_for: nextTriggerAfter({ cron: m.cron, timezone: m.timezone, from: runFrom }).toISOString(),
      }),
    );
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toEqual(pendingRun);
  });

  it('create paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'paused-at-create',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    expect(pendingRun).toBeUndefined();
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('pause drops the pending run; resume re adds a pending run from the new now', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC' }),
      created_by: USER,
      runFrom: new Date('2026-08-27T10:15:00.000Z'),
    });
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeDefined();

    const paused = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'paused' }),
      runFrom: new Date('2026-08-27T10:15:00.000Z'),
    });
    expect(paused).toBeDefined();
    expect(paused?.pendingRun).toBeUndefined();
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();

    const resumeFrom = new Date('2026-08-27T11:30:00.000Z');
    const resumed = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'active' }),
      runFrom: resumeFrom,
    });
    expect(resumed?.pendingRun?.scheduled_for).toBe(
      nextTriggerAfter({ cron: '0 * * * *', timezone: 'UTC', from: resumeFrom }).toISOString(),
    );
  });

  it('updating cron while active replaces the pending run with a new trigger time', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const runFrom = new Date('2026-08-27T08:00:00.000Z');
    const { schedule, pendingRun: first } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'reclock',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC' }),
      created_by: USER,
      runFrom,
    });
    expect(first?.scheduled_for).toBe(
      nextTriggerAfter({ cron: '0 9 * * *', timezone: 'UTC', from: runFrom }).toISOString(),
    );

    const updated = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'reclock',
      manifest: manifest({ cron: '0 17 * * *', timezone: 'UTC' }),
      runFrom,
    });
    expect(updated?.pendingRun?.id).not.toBe(first?.id);
    expect(updated?.pendingRun?.scheduled_for).toBe(
      nextTriggerAfter({ cron: '0 17 * * *', timezone: 'UTC', from: runFrom }).toISOString(),
    );
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toEqual(
      updated?.pendingRun,
    );
  });

  it('updating name or task leaves the pending run unchanged', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const runFrom = new Date('2026-08-27T08:00:00.000Z');
    const { schedule, pendingRun: first } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'label-only',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC', task: 'old task' }),
      created_by: USER,
      runFrom,
    });
    expect(first).toBeDefined();

    // A later runFrom would move the next trigger time if sync ran; it must not.
    const updated = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'renamed',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC', task: 'new task' }),
      runFrom: new Date('2026-08-27T12:00:00.000Z'),
    });

    expect(updated?.schedule.name).toBe('renamed');
    expect(updated?.schedule.manifest.task).toBe('new task');
    expect(updated?.pendingRun).toEqual(first);
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toEqual(first);
  });

  it('updating cron while paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'paused-edit',
      manifest: manifest({ status: 'paused', cron: '0 9 * * *' }),
      created_by: USER,
      runFrom: new Date('2026-08-27T08:00:00.000Z'),
    });

    const updated = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'paused-edit',
      manifest: manifest({ status: 'paused', cron: '0 17 * * *' }),
      runFrom: new Date('2026-08-27T08:00:00.000Z'),
    });
    expect(updated?.pendingRun).toBeUndefined();
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('listScheduledRuns returns only scheduled rows with scheduled_for <= now, not triggered', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    async function pausedSchedule(name: string) {
      const { schedule } = await store.createScheduleAndRun({
        tenant_id: TENANT,
        agent_name: agent.name,
        name,
        manifest: manifest({ status: 'paused' }),
        created_by: USER,
        runFrom: new Date(),
      });
      return schedule;
    }

    const readySchedule = await pausedSchedule('ready');
    const triggeredSchedule = await pausedSchedule('already-triggered');
    const futureSchedule = await pausedSchedule('future');

    const readyRun = await store.createRun({
      tenant_id: TENANT,
      schedule_id: readySchedule.id,
      name: cronRunName(past),
      scheduled_for: past,
      status: 'scheduled',
      triggered_by: USER,
    });

    const triggeredSeed = await store.createRun({
      tenant_id: TENANT,
      schedule_id: triggeredSchedule.id,
      name: cronRunName(past),
      scheduled_for: past,
      status: 'scheduled',
      triggered_by: USER,
    });
    await store.updateRunStatus({
      tenant_id: TENANT,
      id: triggeredSeed.id,
      status: 'triggered',
    });

    await store.createRun({
      tenant_id: TENANT,
      schedule_id: futureSchedule.id,
      name: cronRunName(future),
      scheduled_for: future,
      status: 'scheduled',
      triggered_by: USER,
    });

    // `listScheduledRuns` is deliberately unscoped — dispatch sweeps every schedule —
    // so narrow to this test's schedules. Asserting on the raw list would couple this
    // test to whatever pending rows its neighbours left behind.
    const ownIds = new Set([readySchedule.id, triggeredSchedule.id, futureSchedule.id]);
    const found = await store.listScheduledRuns({ limit: 100, until: new Date() });
    expect(found.filter(run => ownIds.has(run.schedule_id)).map(run => run.id)).toEqual([readyRun.id]);
  });

  it('deleteSchedule removes the schedule and cascades its runs', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'to-delete',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    const historical = await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: cronRunName(past),
      scheduled_for: past,
      status: 'scheduled',
      triggered_by: USER,
    });
    await store.updateRunStatus({
      tenant_id: TENANT,
      id: historical.id,
      status: 'triggered',
    });

    const pending = await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: cronRunName(future),
      scheduled_for: future,
      status: 'scheduled',
      triggered_by: USER,
    });

    await store.deleteSchedule({ tenant_id: TENANT, id: schedule.id });

    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id, forUpdate: false })).toBeUndefined();
    expect(await store.getRun({ tenant_id: TENANT, id: historical.id })).toBeUndefined();
    expect(await store.getRun({ tenant_id: TENANT, id: pending.id })).toBeUndefined();
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
  });

  it('creating a schedule for an unknown agent fails', async () => {
    const store = deps.getScheduleStore();
    await expect(
      store.createScheduleAndRun({
        tenant_id: TENANT,
        agent_name: 'no-such-agent',
        name: 'orphan',
        manifest: manifest(),
        created_by: USER,
        runFrom: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('deleting an agent cascades its schedules and runs', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'bound-to-agent',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC' }),
      created_by: USER,
      runFrom: new Date('2026-08-27T10:00:00.000Z'),
    });
    expect(pendingRun).toBeDefined();

    await deps.getAgentStore().deleteAgent({ tenant_id: TENANT, id: agent.id });

    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id, forUpdate: false })).toBeUndefined();
    expect(await store.getScheduledRunFor({ tenant_id: TENANT, schedule_id: schedule.id })).toBeUndefined();
    if (pendingRun === undefined) {
      throw new Error('expected pending run before agent delete');
    }
    expect(await store.getRun({ tenant_id: TENANT, id: pendingRun.id })).toBeUndefined();
  });

  it('rejects a second schedule_run with the same name on one schedule', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'name-unique',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    const triggersAt = new Date('2026-08-27T12:00:00.000Z');
    const first = await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: cronRunName(triggersAt),
      scheduled_for: triggersAt,
      status: 'scheduled',
      triggered_by: USER,
    });
    await store.updateRunStatus({ tenant_id: TENANT, id: first.id, status: 'triggered' });

    await expect(
      store.createRun({
        tenant_id: TENANT,
        schedule_id: schedule.id,
        name: cronRunName(triggersAt),
        scheduled_for: triggersAt,
        status: 'scheduled',
        triggered_by: USER,
      }),
    ).rejects.toThrow();
  });

  it('rejects a second pending schedule_run for the same schedule', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'one-pending',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    const firstSlot = new Date('2026-08-27T12:00:00.000Z');
    const secondSlot = new Date('2026-08-27T13:00:00.000Z');
    await store.createRun({
      tenant_id: TENANT,
      schedule_id: schedule.id,
      name: cronRunName(firstSlot),
      scheduled_for: firstSlot,
      status: 'scheduled',
      triggered_by: USER,
    });

    await expect(
      store.createRun({
        tenant_id: TENANT,
        schedule_id: schedule.id,
        name: cronRunName(secondSlot),
        scheduled_for: secondSlot,
        status: 'scheduled',
        triggered_by: USER,
      }),
    ).rejects.toThrow();
  });

  it('listSchedules returns newest first and filters by agent_name', async () => {
    const store = deps.getScheduleStore();
    const agentA = await seedAgent();
    const agentB = await seedAgent();

    const older = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentA.name,
      name: 'list-older',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });
    // Distinct `created_at` so newest-first order is stable.
    await new Promise(resolve => setTimeout(resolve, 5));
    const newer = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentA.name,
      name: 'list-newer',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    const otherAgent = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentB.name,
      name: 'list-other-agent',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    const forA = await store.listSchedules({ tenant_id: TENANT, agent_name: agentA.name });
    expect(forA.map(row => row.id)).toEqual([newer.schedule.id, older.schedule.id]);
    expect(forA.every(row => row.agent_name === agentA.name)).toBe(true);

    const forB = await store.listSchedules({ tenant_id: TENANT, agent_name: agentB.name });
    expect(forB.map(row => row.id)).toEqual([otherAgent.schedule.id]);

    const all = await store.listSchedules({ tenant_id: TENANT });
    expect(all.map(row => row.id)).toEqual(
      expect.arrayContaining([newer.schedule.id, older.schedule.id, otherAgent.schedule.id]),
    );
    const indexNewer = all.findIndex(row => row.id === newer.schedule.id);
    const indexOlder = all.findIndex(row => row.id === older.schedule.id);
    expect(indexNewer).toBeGreaterThanOrEqual(0);
    expect(indexOlder).toBeGreaterThanOrEqual(0);
    expect(indexNewer).toBeLessThan(indexOlder);
  });

  it('updateRunStatus stamps triggered_at only for triggered; returns undefined when gone', async () => {
    const store = deps.getScheduleStore();
    const agent = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agent.name,
      name: 'run-status',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    async function seedScheduled(triggersAt: Date) {
      return store.createRun({
        tenant_id: TENANT,
        schedule_id: schedule.id,
        name: cronRunName(triggersAt),
        scheduled_for: triggersAt,
        status: 'scheduled',
        triggered_by: USER,
      });
    }

    const toTrigger = await seedScheduled(new Date('2026-08-27T10:00:00.000Z'));
    expect(toTrigger.triggered_at).toBeNull();
    const triggered = await store.updateRunStatus({
      tenant_id: TENANT,
      id: toTrigger.id,
      status: 'triggered',
    });
    expect(triggered).toEqual(
      expect.objectContaining({
        id: toTrigger.id,
        status: 'triggered',
      }),
    );
    if (triggered === undefined) {
      throw new Error('expected triggered run');
    }
    expect(typeof triggered.triggered_at).toBe('string');
    expect(triggered.triggered_at).not.toBeNull();

    // Pending unique allows only one scheduled row — finish triggered before seeding failed.
    const toFail = await seedScheduled(new Date('2026-08-27T12:00:00.000Z'));
    const failed = await store.updateRunStatus({
      tenant_id: TENANT,
      id: toFail.id,
      status: 'failed',
    });
    expect(failed).toEqual(
      expect.objectContaining({
        id: toFail.id,
        status: 'failed',
        triggered_at: null,
      }),
    );

    await store.deleteSchedule({ tenant_id: TENANT, id: schedule.id });
    expect(
      await store.updateRunStatus({
        tenant_id: TENANT,
        id: triggered.id,
        status: 'failed',
      }),
    ).toBeUndefined();
  });
}
