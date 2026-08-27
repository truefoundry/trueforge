import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { IAgentStore } from '../../src/db/agentStore';
import { cronRunName, type IScheduleStore } from '../../src/db/scheduleStore';
import { nextFireAfter } from '../../src/runtime/cron';
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
  async function seedAgent(): Promise<string> {
    const agent = await deps.getAgentStore().createAgent({
      tenant_id: TENANT,
      name: `agent-${String(Date.now())}`,
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'Be helpful.',
      }),
    });
    return agent.name;
  }

  it('create active schedule adds a pending run for the next cron fire', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const runFrom = new Date('2026-08-27T10:00:00.000Z');
    const m = manifest({ cron: '0 13 * * *', timezone: 'UTC' });

    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
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
        scheduled_for: nextFireAfter(m.cron, m.timezone, runFrom).toISOString(),
      }),
    );
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toEqual(pendingRun);
  });

  it('create paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const { schedule, pendingRun } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
      name: 'paused-at-create',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
      runFrom: new Date(),
    });

    expect(pendingRun).toBeUndefined();
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
  });

  it('pause drops the pending run; resume re adds a pending run from the new now', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC' }),
      created_by: USER,
      runFrom: new Date('2026-08-27T10:15:00.000Z'),
    });
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeDefined();

    const paused = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'paused' }),
      runFrom: new Date('2026-08-27T10:15:00.000Z'),
    });
    expect(paused).toBeDefined();
    expect(paused?.pendingRun).toBeUndefined();
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();

    const resumeFrom = new Date('2026-08-27T11:30:00.000Z');
    const resumed = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'active' }),
      runFrom: resumeFrom,
    });
    expect(resumed?.pendingRun?.scheduled_for).toBe(
      nextFireAfter('0 * * * *', 'UTC', resumeFrom).toISOString(),
    );
  });

  it('updating cron while active replaces the pending run with a new slot', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const runFrom = new Date('2026-08-27T08:00:00.000Z');
    const { schedule, pendingRun: first } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
      name: 'reclock',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC' }),
      created_by: USER,
      runFrom,
    });
    expect(first?.scheduled_for).toBe(nextFireAfter('0 9 * * *', 'UTC', runFrom).toISOString());

    const updated = await store.updateScheduleAndRun({
      tenant_id: TENANT,
      id: schedule.id,
      name: 'reclock',
      manifest: manifest({ cron: '0 17 * * *', timezone: 'UTC' }),
      runFrom,
    });
    expect(updated?.pendingRun?.id).not.toBe(first?.id);
    expect(updated?.pendingRun?.scheduled_for).toBe(nextFireAfter('0 17 * * *', 'UTC', runFrom).toISOString());
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toEqual(updated?.pendingRun);
  });

  it('updating name or task leaves the pending run unchanged', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const runFrom = new Date('2026-08-27T08:00:00.000Z');
    const { schedule, pendingRun: first } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
      name: 'label-only',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC', task: 'old task' }),
      created_by: USER,
      runFrom,
    });
    expect(first).toBeDefined();

    // A later runFrom would move the next slot if sync ran; it must not.
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
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toEqual(first);
  });

  it('updating cron while paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
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
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
  });

  it('findScheduledRuns returns only scheduled rows with scheduled_for <= now, not triggered or missed', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    async function pausedSchedule(name: string) {
      const { schedule } = await store.createScheduleAndRun({
        tenant_id: TENANT,
        agent_name: agentName,
        name,
        manifest: manifest({ status: 'paused' }),
        created_by: USER,
        runFrom: new Date(),
      });
      return schedule;
    }

    const readySchedule = await pausedSchedule('ready');
    const triggeredSchedule = await pausedSchedule('already-triggered');
    const missedSchedule = await pausedSchedule('already-missed');
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

    const missedSeed = await store.createRun({
      tenant_id: TENANT,
      schedule_id: missedSchedule.id,
      name: cronRunName(past),
      scheduled_for: past,
      status: 'scheduled',
      triggered_by: USER,
    });
    await store.updateRunStatus({
      tenant_id: TENANT,
      id: missedSeed.id,
      status: 'missed',
    });

    await store.createRun({
      tenant_id: TENANT,
      schedule_id: futureSchedule.id,
      name: cronRunName(future),
      scheduled_for: future,
      status: 'scheduled',
      triggered_by: USER,
    });

    const found = await store.findScheduledRuns({ limit: 20 });
    expect(found.map(run => run.id)).toEqual([readyRun.id]);
  });

  it('deleteSchedule removes the schedule and cascades its runs', async () => {
    const store = deps.getScheduleStore();
    const agentName = await seedAgent();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    const { schedule } = await store.createScheduleAndRun({
      tenant_id: TENANT,
      agent_name: agentName,
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

    expect(await store.getSchedule({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
    expect(await store.getRun({ tenant_id: TENANT, id: historical.id })).toBeUndefined();
    expect(await store.getRun({ tenant_id: TENANT, id: pending.id })).toBeUndefined();
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: schedule.id })).toBeUndefined();
  });
}
