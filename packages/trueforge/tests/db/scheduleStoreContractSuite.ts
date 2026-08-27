import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { IAgentStore } from '../../src/db/agentStore';
import { syncScheduledRun, type IScheduleStore } from '../../src/db/scheduleStore';
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
    return agent.id;
  }

  it('create active scheduleadds a pending run for the next cron fire', async () => {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const from = new Date('2026-08-27T10:00:00.000Z');
    const m = manifest({ cron: '0 13 * * *', timezone: 'UTC' });

    const created = await store.createSchedule({
      tenant_id: TENANT,
      agent_id: agentId,
      name: 'daily',
      manifest: m,
      created_by: USER,
    });
    const pending = await syncScheduledRun(store, created, from);

    expect(pending).toEqual(
      expect.objectContaining({
        schedule_id: created.id,
        status: 'scheduled',
        triggered_by: USER,
        scheduled_for: nextFireAfter(m.cron, m.timezone, from).toISOString(),
      }),
    );
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toEqual(pending);
  });

  it('create paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const created = await store.createSchedule({
      tenant_id: TENANT,
      agent_id: agentId,
      name: 'paused-at-create',
      manifest: manifest({ status: 'paused' }),
      created_by: USER,
    });

    expect(await syncScheduledRun(store, created, new Date())).toBeUndefined();
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toBeUndefined();
  });

  it('pause drops the pending run; resume re adds a pending run from the new now', async () => {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const created = await store.createSchedule({
      tenant_id: TENANT,
      agent_id: agentId,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC' }),
      created_by: USER,
    });
    await syncScheduledRun(store, created, new Date('2026-08-27T10:15:00.000Z'));
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toBeDefined();

    const paused = await store.updateSchedule({
      tenant_id: TENANT,
      id: created.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'paused' }),
    });
    expect(paused).toBeDefined();
    if (paused === undefined) {
      throw new Error('expected update');
    }
    await syncScheduledRun(store, paused, new Date('2026-08-27T10:15:00.000Z'));
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toBeUndefined();

    const resumeFrom = new Date('2026-08-27T11:30:00.000Z');
    const resumed = await store.updateSchedule({
      tenant_id: TENANT,
      id: created.id,
      name: 'toggle',
      manifest: manifest({ cron: '0 * * * *', timezone: 'UTC', status: 'active' }),
    });
    expect(resumed).toBeDefined();
    if (resumed === undefined) {
      throw new Error('expected update');
    }
    const pending = await syncScheduledRun(store, resumed, resumeFrom);
    expect(pending?.scheduled_for).toBe(nextFireAfter('0 * * * *', 'UTC', resumeFrom).toISOString());
  });

  it('updating cron while active replaces the pending run with a new slot', async () => {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const created = await store.createSchedule({
      tenant_id: TENANT,
      agent_id: agentId,
      name: 'reclock',
      manifest: manifest({ cron: '0 9 * * *', timezone: 'UTC' }),
      created_by: USER,
    });
    const from = new Date('2026-08-27T08:00:00.000Z');
    const first = await syncScheduledRun(store, created, from);
    expect(first?.scheduled_for).toBe(nextFireAfter('0 9 * * *', 'UTC', from).toISOString());

    const updated = await store.updateSchedule({
      tenant_id: TENANT,
      id: created.id,
      name: 'reclock',
      manifest: manifest({ cron: '0 17 * * *', timezone: 'UTC' }),
    });
    expect(updated).toBeDefined();
    if (updated === undefined) {
      throw new Error('expected update');
    }
    const second = await syncScheduledRun(store, updated, from);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.scheduled_for).toBe(nextFireAfter('0 17 * * *', 'UTC', from).toISOString());
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toEqual(second);
  });

  it('updating cron while paused leaves no pending run', async () => {
    const store = deps.getScheduleStore();
    const agentId = await seedAgent();
    const created = await store.createSchedule({
      tenant_id: TENANT,
      agent_id: agentId,
      name: 'paused-edit',
      manifest: manifest({ status: 'paused', cron: '0 9 * * *' }),
      created_by: USER,
    });
    await syncScheduledRun(store, created, new Date('2026-08-27T08:00:00.000Z'));

    const updated = await store.updateSchedule({
      tenant_id: TENANT,
      id: created.id,
      name: 'paused-edit',
      manifest: manifest({ status: 'paused', cron: '0 17 * * *' }),
    });
    expect(updated).toBeDefined();
    if (updated === undefined) {
      throw new Error('expected update');
    }
    await syncScheduledRun(store, updated, new Date('2026-08-27T08:00:00.000Z'));
    expect(await store.getScheduledRun({ tenant_id: TENANT, id: created.id })).toBeUndefined();
  });
}
