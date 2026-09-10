import configuration, { STANDALONE_TRUEFORGE_API_KEY } from '../../../src/config';
import {
  createHttpScheduleRunExecutor,
  executeScheduleRun,
  ScheduleAgentNotFoundError,
  scheduleDispatchLoop,
  scheduleRunFailureReason,
  ScheduleRunNotFoundError,
  startScheduleRun,
} from '../../../src/controller/scheduleDispatch';
import type { ScheduleDispatchItem, ScheduleRunRecord } from '../../../src/db/scheduleStore';
import { ScheduleManifestSchema } from '../../../src/schemas/schedule';

describe('scheduleRunFailureReason', () => {
  it('uses Error.message when non-empty', () => {
    expect(scheduleRunFailureReason(new Error('executor unavailable'))).toBe('executor unavailable');
  });

  it('falls back when message is blank or value is not an Error', () => {
    expect(scheduleRunFailureReason(new Error('   '))).toBe('Schedule run failed');
    expect(scheduleRunFailureReason('boom')).toBe('Schedule run failed');
    expect(scheduleRunFailureReason(null)).toBe('Schedule run failed');
  });
});

function item(): ScheduleDispatchItem {
  return {
    run: {
      id: 'run-1',
      tenant_id: 'default',
      schedule_id: 'sched-1',
      name: 'sched-1',
      scheduled_for: '2026-08-31T00:00:00.000Z',
      status: 'scheduled',
      created_by_subject: { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' },
      triggered_at: null,
      reason: null,
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
    },
    schedule: {
      id: 'sched-1',
      tenant_id: 'default',
      agent_id: 'agent-1',
      agent_name: 'reporter',
      name: 'daily',
      manifest: ScheduleManifestSchema.parse({
        task: 'Write the report',
        cron: '0 * * * *',
        timezone: 'UTC',
        status: 'active',
      }),
      status: 'active',
      created_by_subject: { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' },
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

async function tickDispatch() {
  const dispatchItem = item();
  const store = fakeStore(dispatchItem);
  const logger = fakeLogger();
  const loop = scheduleDispatchLoop({
    scheduleStore: store as never,
    logger: logger as never,
    withTransaction: async callback => callback({} as never),
  });
  await loop.tick(new AbortController().signal);
  return { store, logger };
}

describe('schedule execution HTTP transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends one API-key authenticated request with the run id', async () => {
    const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const executeRun = createHttpScheduleRunExecutor();

    await executeRun('run-1');

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${configuration.SERVER_URL}/api/internal/schedules/runs/execute`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${STANDALONE_TRUEFORGE_API_KEY}`);
    expect(init?.body).toBe(JSON.stringify({ schedule_run_id: 'run-1' }));
  });
});

describe('scheduleDispatchLoop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands the persisted run id to the execution endpoint', async () => {
    const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await tickDispatch();

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${configuration.SERVER_URL}/api/internal/schedules/runs/execute`);
    expect(init?.body).toBe(JSON.stringify({ schedule_run_id: 'run-1' }));
  });

  it('marks HTTP execution failures as failed', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('request failed', { status: 500 }));

    const { logger } = await tickDispatch();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to hand off triggered run',
      expect.objectContaining({ run_id: 'run-1' }),
    );
  });
});

describe('startScheduleRun', () => {
  const startTurn = jest.fn().mockResolvedValue({ id: 'turn-1' });

  beforeEach(() => {
    startTurn.mockClear();
    startTurn.mockResolvedValue({ id: 'turn-1' });
  });

  it('get-or-creates a session and starts a turn with the schedule task', async () => {
    const dispatchItem = item();
    const listTurns = jest.fn().mockResolvedValue({ data: [] });
    const session = { listTurns };
    const getOrCreateByExternalId = jest.fn().mockResolvedValue({ session, created: true });
    const getAgent = jest.fn().mockResolvedValue({ id: 'agent-1', name: 'reporter' });

    await startScheduleRun({
      item: dispatchItem,
      sessions: { getOrCreateByExternalId } as never,
      agentStore: { getAgent } as never,
      startTurn,
    });

    expect(getAgent).toHaveBeenCalledWith({ tenant_id: 'default', name: 'reporter' });
    expect(getOrCreateByExternalId).toHaveBeenCalledWith({
      tenant_id: 'default',
      external_id: 'run-1',
      created_by_subject: { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' },
      agent: { type: 'reference', id: 'agent-1', name: 'reporter' },
      source: { type: 'schedule', id: 'sched-1', run_id: 'run-1' },
    });
    expect(startTurn).toHaveBeenCalledWith({
      session,
      input: [{ type: 'user.message', content: 'Write the report' }],
      previous_turn_id: 'none',
      userRef: 'tester',
      agent: { id: 'agent-1', name: 'reporter' },
    });
  });

  it('does not start a turn when the session already has one', async () => {
    const listTurns = jest.fn().mockResolvedValue({ data: [{ turn_id: 'turn-1' }] });
    const getOrCreateByExternalId = jest.fn().mockResolvedValue({
      session: { listTurns },
      created: false,
    });
    const getAgent = jest.fn().mockResolvedValue({ id: 'agent-1', name: 'reporter' });

    await startScheduleRun({
      item: item(),
      sessions: { getOrCreateByExternalId } as never,
      agentStore: { getAgent } as never,
      startTurn,
    });

    expect(startTurn).not.toHaveBeenCalled();
  });

  it('throws when the schedule agent is missing', async () => {
    await expect(
      startScheduleRun({
        item: item(),
        sessions: { getOrCreateByExternalId: jest.fn() } as never,
        agentStore: { getAgent: jest.fn().mockResolvedValue(undefined) } as never,
        startTurn,
      }),
    ).rejects.toBeInstanceOf(ScheduleAgentNotFoundError);
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe('executeScheduleRun', () => {
  it('loads run context by id before starting the turn', async () => {
    const dispatchItem = item();
    const session = { listTurns: jest.fn().mockResolvedValue({ data: [] }) };
    const startTurn = jest.fn().mockResolvedValue(undefined);
    const getAgent = jest.fn().mockResolvedValue({ id: 'agent-1', name: 'reporter' });
    const scheduleStore = {
      getRunById: jest.fn().mockResolvedValue(dispatchItem.run),
      getSchedule: jest.fn().mockResolvedValue(dispatchItem.schedule),
    };

    await executeScheduleRun({
      scheduleRunId: 'run-1',
      scheduleStore: scheduleStore as never,
      sessions: { getOrCreateByExternalId: jest.fn().mockResolvedValue({ session, created: true }) } as never,
      agentStore: { getAgent } as never,
      startTurn,
    });

    expect(scheduleStore.getRunById).toHaveBeenCalledWith({ id: 'run-1' });
    expect(scheduleStore.getSchedule).toHaveBeenCalledWith({ tenant_id: 'default', id: 'sched-1' });
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { id: 'agent-1', name: 'reporter' },
        userRef: 'tester',
      }),
    );
  });

  it('rejects an unknown run id before loading a schedule', async () => {
    const getSchedule = jest.fn();
    await expect(
      executeScheduleRun({
        scheduleRunId: 'missing',
        scheduleStore: { getRunById: jest.fn().mockResolvedValue(undefined), getSchedule } as never,
        sessions: {} as never,
        agentStore: {} as never,
        startTurn: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(ScheduleRunNotFoundError);
    expect(getSchedule).not.toHaveBeenCalled();
  });
});
