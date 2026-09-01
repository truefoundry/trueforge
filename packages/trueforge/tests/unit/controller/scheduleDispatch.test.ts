import { scheduleDispatchLoop } from '../../../src/controller/scheduleDispatch';
import type { ScheduleDispatchItem, ScheduleRunRecord } from '../../../src/db/scheduleStore';
import { ScheduleManifestSchema } from '../../../src/schemas/schedule';

function item(): ScheduleDispatchItem {
  return {
    run: {
      id: 'run-1',
      tenant_id: 'default',
      schedule_id: 'sched-1',
      name: 'sched-1',
      scheduled_for: '2026-08-31T00:00:00.000Z',
      status: 'scheduled',
      triggered_by: 'tester',
      triggered_at: null,
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
    },
    schedule: {
      id: 'sched-1',
      tenant_id: 'default',
      agent_name: 'reporter',
      name: 'daily',
      manifest: ScheduleManifestSchema.parse({
        task: 'Write the report',
        cron: '0 * * * *',
        timezone: 'UTC',
        status: 'active',
      }),
      status: 'active',
      created_by: 'tester',
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
    },
  };
}

function fakeLogger() {
  return { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

function fakeStore(dispatchItem: ScheduleDispatchItem) {
  return {
    listScheduledRuns: jest.fn().mockResolvedValue([dispatchItem.run]),
    getSchedule: jest.fn().mockResolvedValue(dispatchItem.schedule),
    getScheduleForUpdate: jest.fn().mockResolvedValue(dispatchItem.schedule),
    updateRunStatus: jest.fn().mockResolvedValue(dispatchItem.run satisfies ScheduleRunRecord),
    createRun: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mirrors how the SDK splits these calls: get-or-create is only on `internal.sessions`,
 * turns only on the public `sessions`. Giving each client just its own methods means a call
 * routed to the wrong one throws instead of silently resolving.
 */
async function tickDispatch(mocks: {
  getOrCreateByExternalId: jest.Mock;
  listTurns: jest.Mock;
  createTurn: jest.Mock;
}) {
  const dispatchItem = item();
  const store = fakeStore(dispatchItem);
  const logger = fakeLogger();
  const loop = scheduleDispatchLoop({
    scheduleStore: store as never,
    client: {
      sessions: { listTurns: mocks.listTurns, createTurn: mocks.createTurn },
      internal: { sessions: { getOrCreateByExternalId: mocks.getOrCreateByExternalId } },
    } as never,
    logger: logger as never,
    withTransaction: async callback => callback({} as never),
  });
  await loop.tick(new AbortController().signal);
  return { store, logger };
}

describe('scheduleDispatchLoop', () => {
  it('creates a session and turn through the API client', async () => {
    const getOrCreateByExternalId = jest.fn().mockResolvedValue({ data: { id: 'sess-1' } });
    const listTurns = jest.fn().mockResolvedValue({ data: [] });
    const createTurn = jest.fn().mockResolvedValue({ data: { id: 'turn-1' } });

    await tickDispatch({ getOrCreateByExternalId, listTurns, createTurn });

    expect(getOrCreateByExternalId).toHaveBeenCalledWith({
      externalId: 'run-1',
      agent: { name: 'reporter' },
    });
    expect(listTurns).toHaveBeenCalledWith('sess-1', { limit: 1 });
    expect(createTurn).toHaveBeenCalledWith('sess-1', {
      input: [{ type: 'user.message', content: 'Write the report' }],
      previousTurnId: 'none',
    });
  });

  it('does not call create-turn when the session already has a turn', async () => {
    const getOrCreateByExternalId = jest.fn().mockResolvedValue({ data: { id: 'sess-1' } });
    const listTurns = jest.fn().mockResolvedValue({ data: [{ id: 'turn-1' }] });
    const createTurn = jest.fn();

    await tickDispatch({ getOrCreateByExternalId, listTurns, createTurn });

    expect(createTurn).not.toHaveBeenCalled();
  });

  it('propagates API failures without attempting a turn', async () => {
    const getOrCreateByExternalId = jest.fn().mockRejectedValue(new Error('Agent not found: reporter'));
    const createTurn = jest.fn();
    const { logger } = await tickDispatch({
      getOrCreateByExternalId,
      listTurns: jest.fn(),
      createTurn,
    });

    expect(createTurn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to hand off triggered run',
      expect.objectContaining({ run_id: 'run-1' }),
    );
  });
});
