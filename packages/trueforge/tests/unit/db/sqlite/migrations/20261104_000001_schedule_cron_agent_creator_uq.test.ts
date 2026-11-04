import { sql } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261104_000001_schedule_cron_agent_creator_uq';

describe('SQLite schedule cron, agent, and creator unique index migration', () => {
  it('rejects only duplicate cron bindings for the same tenant, agent, and subject', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE schedule (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          created_by_subject BLOB NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject)
        VALUES (
          'schedule-1',
          'tenant-1',
          'agent-1',
          jsonb('{"cron":"0 13 * * *"}'),
          jsonb('{"subject_id":"user-1"}')
        )
      `.execute(db);

      await up(db);

      await expect(
        sql`
          INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject)
          VALUES (
            'schedule-2',
            'tenant-1',
            'agent-1',
            jsonb('{"cron":"0 13 * * *"}'),
            jsonb('{"subject_id":"user-1"}')
          )
        `.execute(db),
      ).rejects.toThrow(/UNIQUE constraint failed/);

      await sql`
        INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject)
        VALUES
          (
            'different-cron',
            'tenant-1',
            'agent-1',
            jsonb('{"cron":"0 14 * * *"}'),
            jsonb('{"subject_id":"user-1"}')
          ),
          (
            'different-agent',
            'tenant-1',
            'agent-2',
            jsonb('{"cron":"0 13 * * *"}'),
            jsonb('{"subject_id":"user-1"}')
          ),
          (
            'different-subject',
            'tenant-1',
            'agent-1',
            jsonb('{"cron":"0 13 * * *"}'),
            jsonb('{"subject_id":"user-2"}')
          ),
          (
            'different-tenant',
            'tenant-2',
            'agent-1',
            jsonb('{"cron":"0 13 * * *"}'),
            jsonb('{"subject_id":"user-1"}')
          )
      `.execute(db);

      await down(db);

      await sql`
        INSERT INTO schedule (id, tenant_id, agent_name, manifest, created_by_subject)
        VALUES (
          'schedule-3',
          'tenant-1',
          'agent-1',
          jsonb('{"cron":"0 13 * * *"}'),
          jsonb('{"subject_id":"user-1"}')
        )
      `.execute(db);
    } finally {
      await db.destroy();
    }
  });
});
