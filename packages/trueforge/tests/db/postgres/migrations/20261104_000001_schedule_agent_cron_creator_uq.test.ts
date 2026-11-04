import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261104_000001_schedule_agent_cron_creator_uq';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261103_000001_sandbox_environment_type_truefoundry';

function subject(id: string): string {
  return JSON.stringify({ subject_id: id, subject_type: 'user', subject_display_name: id });
}

function scheduleManifest(cron: string): string {
  return JSON.stringify({ task: 'Say hello', cron, timezone: 'UTC', status: 'paused' });
}

describePg('Postgres schedule agent/cron/creator unique migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeEach(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
    await sql`
      INSERT INTO agent (id, tenant_id, name, description, manifest, created_by_subject, created_at, updated_at)
      VALUES ('agent-1', 't', 'agent-one', '', '{}'::jsonb, ${subject('u1')}::jsonb, now(), now())
    `.execute(env.db);
    const rows: { id: string; name: string; cron: string; creator: string; createdAt: string }[] = [
      { id: 's-old', name: 'old', cron: '0 9 * * *', creator: 'u1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 's-dup', name: 'dup', cron: '0 9 * * *', creator: 'u1', createdAt: '2026-02-01T00:00:00Z' },
      { id: 's-other-user', name: 'other-user', cron: '0 9 * * *', creator: 'u2', createdAt: '2026-03-01T00:00:00Z' },
      { id: 's-other-cron', name: 'other-cron', cron: '0 10 * * *', creator: 'u1', createdAt: '2026-03-01T00:00:00Z' },
    ];
    for (const row of rows) {
      await sql`
        INSERT INTO schedule (
          id, tenant_id, agent_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
        ) VALUES (
          ${row.id}, 't', 'agent-1', 'agent-one', ${row.name}, ${scheduleManifest(row.cron)}::jsonb, 'paused',
          ${subject(row.creator)}::jsonb, ${row.createdAt}::timestamptz, ${row.createdAt}::timestamptz
        )
      `.execute(env.db);
    }
    await sql`
      INSERT INTO schedule_run (
        id, tenant_id, schedule_id, name, scheduled_for, status, created_by_subject, created_at, updated_at
      ) VALUES ('run-dup', 't', 's-dup', 'sched-1', now(), 'triggered', ${subject('u1')}::jsonb, now(), now())
    `.execute(env.db);
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    await env.db.transaction().execute(async transaction => {
      if (direction === 'up') {
        await up(transaction);
      } else {
        await down(transaction);
      }
    });
  }

  async function scheduleIds(): Promise<string[]> {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const result = await sql<{ id: string }>`SELECT id FROM schedule ORDER BY id`.execute(env.db);
    return result.rows.map(row => row.id);
  }

  it('keeps the oldest duplicate, cascades its runs, and enforces uniqueness until down', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    await migrate('up');
    expect(await scheduleIds()).toEqual(['s-old', 's-other-cron', 's-other-user']);
    const runs = await sql<{ id: string }>`SELECT id FROM schedule_run WHERE id = 'run-dup'`.execute(env.db);
    expect(runs.rows).toEqual([]);

    const insertDuplicate = sql`
      INSERT INTO schedule (
        id, tenant_id, agent_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
      ) VALUES (
        's-new', 't', 'agent-1', 'agent-one', 'new', ${scheduleManifest('0 9 * * *')}::jsonb, 'paused',
        ${subject('u1')}::jsonb, now(), now()
      )
    `;
    await expect(insertDuplicate.execute(env.db)).rejects.toMatchObject({
      code: '23505',
      constraint: 'schedule_agent_cron_creator_uq',
    });

    await migrate('down');
    await expect(insertDuplicate.execute(env.db)).resolves.toBeDefined();
  });
});
