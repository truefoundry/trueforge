import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_CRON_CREATOR_UQ } from '../../indexes';

/**
 * One schedule per `(agent, cron, creator)` — mirrors
 * db/postgres/migrations/20261104_000001_schedule_agent_cron_creator_uq.ts.
 *
 * Existing duplicates keep the oldest row (`created_at`, then `id`); newer ones are deleted
 * with their runs (FK cascade), so `down` cannot restore them.
 * A plain CREATE INDEX needs no table rebuild, so no `PRAGMA foreign_keys` toggle.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
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

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}`.execute(trx);
  });
}
