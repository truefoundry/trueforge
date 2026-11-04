import { sql, type Kysely } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261104_000001_schedule_cron_uq';

function subject(subjectId: string): string {
  return JSON.stringify({ subject_id: subjectId, subject_type: 'user', subject_display_name: subjectId });
}

async function insertSchedule<TDatabase>(
  db: Kysely<TDatabase>,
  { id, cron, subjectId, createdAt }: { id: string; cron: string; subjectId: string; createdAt: string },
): Promise<void> {
  const manifest = JSON.stringify({ task: 'Say hi', cron, timezone: 'UTC', status: 'paused' });
  await sql`
    INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject, created_at)
    VALUES (${id}, 'tenant-1', 'reporter', jsonb(${manifest}), jsonb(${subject(subjectId)}), ${createdAt})
  `.execute(db);
}

describe('SQLite schedule cron unique migration', () => {
  it('keeps the oldest of each duplicate group, cascades runs, then enforces the index', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE schedule (
          id TEXT NOT NULL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE schedule_run (
          id TEXT NOT NULL PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES schedule (id) ON DELETE CASCADE
        ) STRICT
      `.execute(db);

      await insertSchedule(db, {
        id: 'b',
        cron: '0 9 * * *',
        subjectId: 'alice',
        createdAt: '2026-01-02T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'a',
        cron: '0 9 * * *',
        subjectId: 'alice',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await insertSchedule(db, {
        id: 'c',
        cron: '0 17 * * *',
        subjectId: 'alice',
        createdAt: '2026-01-03T00:00:00.000Z',
      });
      await insertSchedule(db, { id: 'd', cron: '0 9 * * *', subjectId: 'bob', createdAt: '2026-01-04T00:00:00.000Z' });
      await sql`INSERT INTO schedule_run (id, schedule_id) VALUES ('run-b', 'b')`.execute(db);

      await up(db);

      const remaining = await sql<{ id: string }>`SELECT id FROM schedule ORDER BY id`.execute(db);
      expect(remaining.rows.map(row => row.id)).toEqual(['a', 'c', 'd']);
      const runs = await sql<{ id: string }>`SELECT id FROM schedule_run`.execute(db);
      expect(runs.rows).toEqual([]);

      await expect(
        insertSchedule(db, { id: 'e', cron: '0 9 * * *', subjectId: 'alice', createdAt: '2026-01-05T00:00:00.000Z' }),
      ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });

      await down(db);
      await expect(
        insertSchedule(db, { id: 'e', cron: '0 9 * * *', subjectId: 'alice', createdAt: '2026-01-05T00:00:00.000Z' }),
      ).resolves.toBeUndefined();
    } finally {
      await db.destroy();
    }
  });
});
