import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createPermissionsRouter } from '../../../src/apis/permissions';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteScheduleStore } from '../../../src/db/sqlite/schedule-store/SqliteScheduleStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { ListPermissionsResponseSchema } from '../../../src/schemas/permissions';
import { ScheduleManifestSchema } from '../../../src/schemas/schedule';

const ALICE: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'alice', type: 'user', display_name: 'alice' },
  roles: [],
  user_credential: null,
};
const BOB: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'bob', type: 'user', display_name: 'bob' },
  roles: [],
  user_credential: null,
};

describe('list-permissions', () => {
  it('returns USE for everyone on agents and MANAGE/DELETE only for the owner', async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const agentStore = new SqliteAgentStore(db);
    const scheduleStore = new SqliteScheduleStore(db);
    const sessionStore = new SqliteSessionStore(db);

    const agent = await agentStore.createAgent({
      tenant_id: 'default',
      name: 'reporter',
      manifest: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
      external_id: null,
      created_by_subject: {
        subject_id: 'alice',
        subject_type: 'user',
        subject_display_name: 'alice',
      },
    });
    const schedule = await scheduleStore.createScheduleAndRun({
      tenant_id: 'default',
      agent_id: agent.id,
      agent_name: agent.name,
      name: 'daily',
      manifest: ScheduleManifestSchema.parse({ task: 'Say hi', cron: '0 13 * * *', timezone: 'UTC' }),
      created_by_subject: {
        subject_id: 'alice',
        subject_type: 'user',
        subject_display_name: 'alice',
      },
      runFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    let current = ALICE;
    const app = new OpenAPIHono();
    app.route(
      '/',
      createPermissionsRouter({
        authorizer: new TrueForgeAuthorizer(),
        resolveAgentStore: () => agentStore,
        scheduleStore,
        sessionStore,
        resolveRequestContext: () => current,
      }),
    );

    const list = async (body: unknown) => {
      const res = await app.request('/list-permissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      return ListPermissionsResponseSchema.parse(await res.json());
    };

    current = ALICE;
    const aliceAgents = await list({ resource_type: 'agent', resource_ids: [agent.id, 'missing-agent'] });
    expect(aliceAgents.data).toEqual({
      [agent.id]: ['USE', 'MANAGE', 'DELETE'],
      'missing-agent': ['USE'],
    });

    current = BOB;
    const bobAgents = await list({ resource_type: 'agent', resource_ids: [agent.id] });
    expect(bobAgents.data).toEqual({ [agent.id]: ['USE'] });

    current = ALICE;
    const aliceSchedules = await list({ resource_type: 'schedule', resource_ids: [schedule.schedule.id] });
    expect(aliceSchedules.data).toEqual({ [schedule.schedule.id]: ['MANAGE', 'DELETE'] });

    current = BOB;
    const bobSchedules = await list({ resource_type: 'schedule', resource_ids: [schedule.schedule.id] });
    expect(bobSchedules.data).toEqual({ [schedule.schedule.id]: [] });
  });
});
