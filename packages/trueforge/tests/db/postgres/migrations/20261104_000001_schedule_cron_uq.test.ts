import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261104_000001_schedule_cron_uq';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261103_000001_sandbox_environment_type_truefoundry';

function subject(subjectId: string): string {
  return JSON.stringify({ subject_id: subjectId, subject_type: 'user', subject_display_name: subjectId });
}

describePg('Postgres schedule cron unique migration', () => {
  let env: PostgresTestDatabase | undefined;

  function db() {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env.db;
  }

  async function insertSchedule({
    id,
    name,
    cron,
    subjectId,
    createdAt,
  }: {
    id: string;
    name: string;
    cron: string;
    subjectId: string;
    createdAt: string;
  }): Promise<void> {
    const manifest = JSON.stringify({ task: 'Say hi', cron, timezone: 'UTC', status: 'paused' });
    await sql`
      INSERT INTO schedule (
        id, tenant_id, agent_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
      ) VALUES (
        ${id}, 'tenant-1', 'agent-1', 'reporter', ${name}, ${manifest}::jsonb, 'paused',
        ${subject(subjectId)}::jsonb, ${createdAt}::timestamptz, ${createdAt}::timestamptz
      )
    `.execute(db());
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    await db()
      .transaction()
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
    await sql`
      INSERT INTO agent (id, tenant_id, name, description, manifest, created_by_subject, created_at, updated_at)
      VALUES (
        'agent-1', 'tenant-1', 'reporter', '', ${JSON.stringify({ model: { name: 'p/m' } })}::jsonb,
        ${subject('alice')}::jsonb, now(), now()
      )
    `.execute(env.db);
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  it('keeps the oldest of each duplicate group, cascades runs, then enforces the index', async () => {
    await insertSchedule({
      id: 'b',
      name: 'newer',
      cron: '0 9 * * *',
      subjectId: 'alice',
      createdAt: '2026-01-02T00:00:00Z',
    });
    await insertSchedule({
      id: 'a',
      name: 'older',
      cron: '0 9 * * *',
      subjectId: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
    });
    await insertSchedule({
      id: 'c',
      name: 'other-cron',
      cron: '0 17 * * *',
      subjectId: 'alice',
      createdAt: '2026-01-03T00:00:00Z',
    });
    await insertSchedule({
      id: 'd',
      name: 'other-user',
      cron: '0 9 * * *',
      subjectId: 'bob',
      createdAt: '2026-01-04T00:00:00Z',
    });
    await sql`
      INSERT INTO schedule_run (
        id, tenant_id, schedule_id, name, scheduled_for, status, created_by_subject, created_at, updated_at
      ) VALUES ('run-b', 'tenant-1', 'b', 'sched-1', now(), 'succeeded', ${subject('alice')}::jsonb, now(), now())
    `.execute(db());

    await migrate('up');

    const remaining = await sql<{ id: string }>`SELECT id FROM schedule ORDER BY id`.execute(db());
    expect(remaining.rows.map(row => row.id)).toEqual(['a', 'c', 'd']);
    const runs = await sql<{ id: string }>`SELECT id FROM schedule_run`.execute(db());
    expect(runs.rows).toEqual([]);

    await expect(
      insertSchedule({
        id: 'e',
        name: 'dup',
        cron: '0 9 * * *',
        subjectId: 'alice',
        createdAt: '2026-01-05T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'schedule_cron_uq' });

    await migrate('down');
    await expect(
      insertSchedule({
        id: 'e',
        name: 'dup',
        cron: '0 9 * * *',
        subjectId: 'alice',
        createdAt: '2026-01-05T00:00:00Z',
      }),
    ).resolves.toBeUndefined();
  });
});
