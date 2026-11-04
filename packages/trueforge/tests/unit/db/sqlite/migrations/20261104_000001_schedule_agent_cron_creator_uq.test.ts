import { sql, type Kysely } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261104_000001_schedule_agent_cron_creator_uq';

function subject(id: string): string {
  return JSON.stringify({ subject_id: id, subject_type: 'user', subject_display_name: id });
}

async function insertSchedule<TDatabase>(
  db: Kysely<TDatabase>,
  row: { id: string; agent_name: string; cron: string; creator: string; created_at: string },
): Promise<void> {
  const manifest = JSON.stringify({ task: 'Say hi', cron: row.cron, timezone: 'UTC', status: 'active' });
  await sql`
    INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject, created_at)
    VALUES (${row.id}, 'default', ${row.agent_name}, jsonb(${manifest}), jsonb(${subject(row.creator)}), ${row.created_at})
  `.execute(db);
}

async function scheduleIds<TDatabase>(db: Kysely<TDatabase>): Promise<string[]> {
  const result = await sql<{ id: string }>`SELECT id FROM schedule ORDER BY id`.execute(db);
  return result.rows.map(row => row.id);
}

describe('SQLite schedule agent/cron/creator unique migration', () => {
  it('keeps the oldest duplicate, cascades runs of the rest, and enforces uniqueness until down', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE schedule (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE schedule_run (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES schedule (id) ON DELETE CASCADE
        ) STRICT
      `.execute(db);

      await insertSchedule(db, {
        id: 'a-newer',
        agent_name: 'reporter',
        cron: '0 9 * * *',
        creator: 'alice',
        created_at: '2026-10-02T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'b-oldest',
        agent_name: 'reporter',
        cron: '0 9 * * *',
        creator: 'alice',
        created_at: '2026-10-01T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'c-other-creator',
        agent_name: 'reporter',
        cron: '0 9 * * *',
        creator: 'bob',
        created_at: '2026-10-03T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'd-other-cron',
        agent_name: 'reporter',
        cron: '0 17 * * *',
        creator: 'alice',
        created_at: '2026-10-03T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'e-other-agent',
        agent_name: 'writer',
        cron: '0 9 * * *',
        creator: 'alice',
        created_at: '2026-10-03T00:00:00.000Z',
      });
      await sql`INSERT INTO schedule_run (id, schedule_id) VALUES ('run-newer', 'a-newer'), ('run-oldest', 'b-oldest')`.execute(
        db,
      );

      await up(db);

      expect(await scheduleIds(db)).toEqual(['b-oldest', 'c-other-creator', 'd-other-cron', 'e-other-agent']);
      const runs = await sql<{ id: string }>`SELECT id FROM schedule_run ORDER BY id`.execute(db);
      expect(runs.rows.map(row => row.id)).toEqual(['run-oldest']);

      const duplicate = {
        id: 'f-duplicate',
        agent_name: 'reporter',
        cron: '0 9 * * *',
        creator: 'alice',
        created_at: '2026-10-04T00:00:00.000Z',
      };
      await expect(insertSchedule(db, duplicate)).rejects.toThrow(/UNIQUE constraint failed/);

      await down(db);
      await insertSchedule(db, duplicate);
      expect(await scheduleIds(db)).toContain('f-duplicate');
    } finally {
      await db.destroy();
    }
  });
});
