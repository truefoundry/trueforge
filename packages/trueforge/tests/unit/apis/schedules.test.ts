import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createSchedulesRouter } from '../../../src/apis/schedules';
import type { RequestContext } from '../../../src/auth/identity';
import { ScheduleAgentNotFoundError, startScheduleRun } from '../../../src/controller/scheduleDispatch';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteScheduleStore } from '../../../src/db/sqlite/schedule-store/SqliteScheduleStore';
import {
  CreateScheduleRunResponseSchema,
  ListScheduleRunsResponseSchema,
  ListSchedulesResponseSchema,
} from '../../../src/schemas/schedule';

jest.mock('../../../src/controller/scheduleDispatch', () => ({
  ...jest.requireActual<typeof import('../../../src/controller/scheduleDispatch')>(
    '../../../src/controller/scheduleDispatch',
  ),
  startScheduleRun: jest.fn().mockResolvedValue(undefined),
}));

const mockedStartScheduleRun = jest.mocked(startScheduleRun);

const ALICE: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'alice', type: 'user', display_name: 'alice' },
  is_admin: false,
  user_credential: null,
};
const BOB: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'bob', type: 'user', display_name: 'bob' },
  is_admin: false,
  user_credential: null,
};
const ADMIN: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'root', type: 'user', display_name: 'root' },
  is_admin: true,
  user_credential: null,
};

const scheduleBody = {
  agent_name: 'reporter',
  name: 'daily-report',
  manifest: { task: 'Say hi', cron: '0 13 * * *', timezone: 'UTC' },
};

async function setup() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const agentStore = new SqliteAgentStore(db);
  const scheduleStore = new SqliteScheduleStore(db);
  await agentStore.createAgent({
    tenant_id: 'default',
    name: 'reporter',
    manifest: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
    external_id: null,
  });

  let current: RequestContext = ALICE;
  const app = new OpenAPIHono();
  app.route(
    '/',
    createSchedulesRouter({
      scheduleStore,
      agentStore,
      sessions: {
        getOrCreateByExternalId: () => Promise.reject(new Error('sessions stub: unexpected call')),
      } as never,
      turnDeps: {
        activeTurns: {} as never,
        eventSubscriptions: {} as never,
        modelProviderStore: {} as never,
        mcpServerStore: {} as never,
        tokenStore: {} as never,
        skillStore: {} as never,
        agentStore,
        sandboxProviderStore: {} as never,
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as never,
      },
      withTransaction: callback => db.transaction().execute(callback),
      resolveRequestContext: () => current,
    }),
  );

  const asUser = (user: RequestContext) => {
    current = user;
  };
  const postJson = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return { app, asUser, postJson, agentStore, scheduleStore };
}

describe('schedule RBAC — creator-scoped, admin sees all', () => {
  it("hides another user's schedule from get, update, delete, list, and run trigger", async () => {
    const { app, asUser, postJson } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    expect(created.status).toBe(201);
    const { id } = ((await created.json()) as { data: { id: string } }).data;

    asUser(BOB);
    expect((await app.request(`/${id}`)).status).toBe(403);
    expect((await postJson(`/${id}`, 'PUT', { name: 'renamed', manifest: scheduleBody.manifest })).status).toBe(403);
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(403);

    const bobList = await app.request('/');
    expect(bobList.status).toBe(200);
    expect(ListSchedulesResponseSchema.parse(await bobList.json()).data).toEqual([]);

    expect((await app.request(`/${id}/runs`)).status).toBe(403);
    expect((await postJson('/runs', 'POST', { schedule_id: id })).status).toBe(403);
    expect(mockedStartScheduleRun).not.toHaveBeenCalled();
  });

  it('lets the creator see and manage their own schedule', async () => {
    const { app, asUser, postJson } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    const { id } = ((await created.json()) as { data: { id: string } }).data;

    expect((await app.request(`/${id}`)).status).toBe(200);
    const aliceList = await app.request('/');
    expect(ListSchedulesResponseSchema.parse(await aliceList.json()).data).toHaveLength(1);
    const aliceRuns = await app.request(`/${id}/runs`);
    expect(aliceRuns.status).toBe(200);
    expect(ListScheduleRunsResponseSchema.parse(await aliceRuns.json()).data).toEqual([
      expect.objectContaining({ schedule_id: id }),
    ]);
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('does not leak existence: a missing schedule is 404, not 403', async () => {
    const { app, asUser, postJson } = await setup();
    asUser(BOB);
    expect((await app.request('/01jqzz000000000000000nope')).status).toBe(404);
    expect((await app.request('/01jqzz000000000000000nope/runs')).status).toBe(404);
    expect((await postJson('/runs', 'POST', { schedule_id: '01jqzz000000000000000nope' })).status).toBe(404);
  });

  it("lets an admin see and manage any user's schedule", async () => {
    const { app, asUser, postJson } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    const { id } = ((await created.json()) as { data: { id: string } }).data;

    asUser(ADMIN);
    expect((await app.request(`/${id}`)).status).toBe(200);

    const adminList = await app.request('/');
    expect(ListSchedulesResponseSchema.parse(await adminList.json()).data).toHaveLength(1);
    const adminRuns = await app.request(`/${id}/runs`);
    expect(ListScheduleRunsResponseSchema.parse(await adminRuns.json()).data).toHaveLength(1);

    const renamed = await postJson(`/${id}`, 'PUT', { name: 'admin-renamed', manifest: scheduleBody.manifest });
    expect(renamed.status).toBe(200);
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('shows an admin schedules across multiple creators in list', async () => {
    const { app, asUser, agentStore, postJson } = await setup();
    // A second agent so both schedules can share the same name without colliding.
    await agentStore.createAgent({
      tenant_id: 'default',
      name: 'reporter-two',
      manifest: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
      external_id: null,
    });

    asUser(ALICE);
    const aliceCreated = await postJson('/', 'POST', scheduleBody);
    const aliceId = ((await aliceCreated.json()) as { data: { id: string } }).data.id;
    asUser(BOB);
    const bobCreated = await postJson('/', 'POST', { ...scheduleBody, agent_name: 'reporter-two' });
    const bobId = ((await bobCreated.json()) as { data: { id: string } }).data.id;

    asUser(ADMIN);
    const adminList = await app.request('/');
    expect(ListSchedulesResponseSchema.parse(await adminList.json()).data).toHaveLength(2);
    // An admin reaches the runs of a schedule created by anyone.
    expect(ListScheduleRunsResponseSchema.parse(await (await app.request(`/${bobId}/runs`)).json()).data).toEqual([
      expect.objectContaining({ schedule_id: bobId }),
    ]);

    // A regular user still sees only their own.
    asUser(BOB);
    const bobList = await app.request('/');
    expect(ListSchedulesResponseSchema.parse(await bobList.json()).data).toHaveLength(1);
    expect(ListScheduleRunsResponseSchema.parse(await (await app.request(`/${bobId}/runs`)).json()).data).toHaveLength(
      1,
    );
    expect((await app.request(`/${aliceId}/runs`)).status).toBe(403);
  });
});

describe('schedule list agent_names filter', () => {
  it('filters by a single agent_names value and by comma-separated agent_names', async () => {
    const { app, asUser, agentStore, postJson } = await setup();
    await agentStore.createAgent({
      tenant_id: 'default',
      name: 'reporter-two',
      manifest: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
      external_id: null,
    });

    asUser(ALICE);
    const aliceCreated = await postJson('/', 'POST', scheduleBody);
    const aliceId = ((await aliceCreated.json()) as { data: { id: string } }).data.id;
    const secondCreated = await postJson('/', 'POST', {
      ...scheduleBody,
      agent_name: 'reporter-two',
      name: 'daily-report-two',
    });
    const secondId = ((await secondCreated.json()) as { data: { id: string } }).data.id;

    const single = await app.request('/?agent_names=reporter');
    expect(single.status).toBe(200);
    expect(ListSchedulesResponseSchema.parse(await single.json()).data.map(row => row.id)).toEqual([aliceId]);

    const multi = await app.request('/?agent_names=reporter,reporter-two');
    expect(multi.status).toBe(200);
    expect(
      ListSchedulesResponseSchema.parse(await multi.json())
        .data.map(row => row.id)
        .sort(),
    ).toEqual([aliceId, secondId].sort());

    const withGaps = await app.request('/?agent_names=reporter,,reporter-two');
    expect(withGaps.status).toBe(200);
    expect(
      ListSchedulesResponseSchema.parse(await withGaps.json())
        .data.map(row => row.id)
        .sort(),
    ).toEqual([aliceId, secondId].sort());

    const omitted = await app.request('/');
    expect(ListSchedulesResponseSchema.parse(await omitted.json()).data).toHaveLength(2);

    // Present but empty / comma-only values fail validation.
    for (const query of ['/?agent_names=', '/?agent_names=,,,', '/?agent_names=%20,%20']) {
      const empty = await app.request(query);
      expect(empty.status).toBe(400);
    }
  });
});

describe('create schedule run', () => {
  beforeEach(() => {
    mockedStartScheduleRun.mockReset();
    mockedStartScheduleRun.mockResolvedValue(undefined);
  });

  it('creates a triggered run with a manual-* name and leaves the cron pending run alone', async () => {
    const { asUser, postJson, scheduleStore } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    const { id: scheduleId } = ((await created.json()) as { data: { id: string } }).data;

    const pendingBefore = await scheduleStore.getScheduledRunFor({ tenant_id: 'default', schedule_id: scheduleId });
    expect(pendingBefore?.status).toBe('scheduled');

    const res = await postJson('/runs', 'POST', { schedule_id: scheduleId });
    expect(res.status).toBe(201);
    const body = CreateScheduleRunResponseSchema.parse(await res.json());
    expect(body.data).toEqual(
      expect.objectContaining({
        schedule_id: scheduleId,
        status: 'triggered',
        triggered_by: 'alice',
        name: expect.stringMatching(/^manual-/),
      }),
    );
    expect(body.data.triggered_at).not.toBeNull();

    expect(mockedStartScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({
          run: expect.objectContaining({ id: body.data.id }),
          schedule: expect.objectContaining({ id: scheduleId }),
        }),
      }),
    );

    const pendingAfter = await scheduleStore.getScheduledRunFor({ tenant_id: 'default', schedule_id: scheduleId });
    expect(pendingAfter?.id).toBe(pendingBefore?.id);
    expect(pendingAfter?.status).toBe('scheduled');

    const runs = await scheduleStore.listRuns({ tenant_id: 'default', schedule_id: scheduleId });
    expect(runs.map(r => r.status).sort()).toEqual(['scheduled', 'triggered']);
  });

  it('lets an admin trigger a run owned by another user', async () => {
    const { asUser, postJson } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    const { id: scheduleId } = ((await created.json()) as { data: { id: string } }).data;

    asUser(ADMIN);
    const res = await postJson('/runs', 'POST', { schedule_id: scheduleId });
    expect(res.status).toBe(201);
    const body = CreateScheduleRunResponseSchema.parse(await res.json());
    expect(body.data.triggered_by).toBe('root');
    expect(mockedStartScheduleRun).toHaveBeenCalled();
  });

  it('marks the run failed and returns 404 when startScheduleRun reports a missing agent', async () => {
    mockedStartScheduleRun.mockRejectedValue(new ScheduleAgentNotFoundError('reporter'));
    const { asUser, postJson, scheduleStore } = await setup();

    asUser(ALICE);
    const created = await postJson('/', 'POST', scheduleBody);
    const { id: scheduleId } = ((await created.json()) as { data: { id: string } }).data;

    const res = await postJson('/runs', 'POST', { schedule_id: scheduleId });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Agent not found: reporter');

    const runs = await scheduleStore.listRuns({ tenant_id: 'default', schedule_id: scheduleId });
    const runNow = runs.find(r => r.name.startsWith('manual-'));
    expect(runNow?.status).toBe('failed');
  });
});
