import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261104_000001_schedule_agent_cron_creator_uq';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261103_000001_sandbox_environment_type_truefoundry';

function subject(id: string): string {
  return JSON.stringify({ subject_id: id, subject_type: 'user', subject_display_name: id });
}

describePg('Postgres schedule agent/cron/creator unique migration', () => {
  let env: PostgresTestDatabase | undefined;

  function requireEnv(): PostgresTestDatabase {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env;
  }

  async function insertSchedule(row: {
    id: string;
    agent_id: string;
    cron: string;
    creator: string;
    created_at: string;
  }): Promise<void> {
    const manifest = JSON.stringify({ task: 'Say hi', cron: row.cron, timezone: 'UTC', status: 'active' });
    await sql`
      INSERT INTO schedule (
        id, tenant_id, agent_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
      ) VALUES (
        ${row.id}, 'default', ${row.agent_id}, ${row.agent_id}, ${row.id}, ${manifest}::jsonb, 'active',
        ${subject(row.creator)}::jsonb, ${row.created_at}::timestamptz, now()
      )
    `.execute(requireEnv().db);
  }

  async function scheduleIds(): Promise<string[]> {
    const result = await sql<{ id: string }>`SELECT id FROM schedule ORDER BY id`.execute(requireEnv().db);
    return result.rows.map(row => row.id);
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    await requireEnv()
      .db.transaction()
      .execute(async transaction => {
        if (direction === 'up') {
          await up(transaction);
        } else {
          await down(transaction);
        }
      });
  }

  beforeEach(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
    for (const agent of ['reporter', 'writer']) {
      await sql`
        INSERT INTO agent (id, tenant_id, name, description, manifest, created_by_subject, created_at, updated_at)
        VALUES (${agent}, 'default', ${agent}, '', '{}'::jsonb, ${subject('alice')}::jsonb, now(), now())
      `.execute(env.db);
    }
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  it('keeps the oldest duplicate, cascades runs of the rest, and enforces uniqueness until down', async () => {
    await insertSchedule({
      id: 'a-newer',
      agent_id: 'reporter',
      cron: '0 9 * * *',
      creator: 'alice',
      created_at: '2026-10-02T00:00:00.000Z',
    });
    await insertSchedule({
      id: 'b-oldest',
      agent_id: 'reporter',
      cron: '0 9 * * *',
      creator: 'alice',
      created_at: '2026-10-01T00:00:00.000Z',
    });
    await insertSchedule({
      id: 'c-other-creator',
      agent_id: 'reporter',
      cron: '0 9 * * *',
      creator: 'bob',
      created_at: '2026-10-03T00:00:00.000Z',
    });
    await insertSchedule({
      id: 'd-other-cron',
      agent_id: 'reporter',
      cron: '0 17 * * *',
      creator: 'alice',
      created_at: '2026-10-03T00:00:00.000Z',
    });
    await insertSchedule({
      id: 'e-other-agent',
      agent_id: 'writer',
      cron: '0 9 * * *',
      creator: 'alice',
      created_at: '2026-10-03T00:00:00.000Z',
    });
    for (const scheduleId of ['a-newer', 'b-oldest']) {
      await sql`
        INSERT INTO schedule_run (
          id, tenant_id, schedule_id, name, scheduled_for, status, created_by_subject, created_at, updated_at
        ) VALUES (
          ${`run-${scheduleId}`}, 'default', ${scheduleId}, 'sched-1', now(), 'scheduled',
          ${subject('alice')}::jsonb, now(), now()
        )
      `.execute(requireEnv().db);
    }

    await migrate('up');

    expect(await scheduleIds()).toEqual(['b-oldest', 'c-other-creator', 'd-other-cron', 'e-other-agent']);
    const runs = await sql<{ id: string }>`SELECT id FROM schedule_run ORDER BY id`.execute(requireEnv().db);
    expect(runs.rows.map(row => row.id)).toEqual(['run-b-oldest']);

    const duplicate = {
      id: 'f-duplicate',
      agent_id: 'reporter',
      cron: '0 9 * * *',
      creator: 'alice',
      created_at: '2026-10-04T00:00:00.000Z',
    };
    await expect(insertSchedule(duplicate)).rejects.toMatchObject({ constraint: 'schedule_agent_cron_creator_uq' });

    await migrate('down');
    await insertSchedule(duplicate);
    expect(await scheduleIds()).toContain('f-duplicate');
  });
});
