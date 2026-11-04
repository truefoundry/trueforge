import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_CRON_CREATOR_UQ } from '../../indexes';

/**
 * SQLite mirror of postgres/migrations/20261104_000001_schedule_agent_cron_creator_uq.ts.
 * Deleting duplicates relies on `foreign_keys = ON` (set by the client) to cascade their runs.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      DELETE FROM schedule
      WHERE id IN (
        SELECT id
        FROM (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY
                tenant_id,
                agent_name,
                json_extract(manifest, '$.cron'),
                json_extract(created_by_subject, '$.subject_id')
              ORDER BY created_at, id
            ) AS rn
          FROM schedule
        )
        WHERE rn > 1
      )
    `.execute(trx);
    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}
        ON schedule (
          tenant_id,
          agent_name,
          json_extract(manifest, '$.cron'),
          json_extract(created_by_subject, '$.subject_id')
        )
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}`.execute(trx);
  });
}
