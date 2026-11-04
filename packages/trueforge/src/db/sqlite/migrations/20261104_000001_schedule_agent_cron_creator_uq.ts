import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_CRON_CREATOR_UQ } from '../../indexes';

/**
 * UNIQUE (tenant_id, agent_name, manifest.cron, created_by_subject.subject_id) on schedule —
 * mirrors db/postgres/migrations/20261104_000001_schedule_agent_cron_creator_uq.ts.
 *
 * Existing duplicates are removed first, keeping the oldest schedule per key. Their runs are
 * deleted explicitly rather than relying on the FK cascade, which is a no-op when
 * `PRAGMA foreign_keys` is off. better-sqlite3 prepares one statement per call.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TEMP TABLE schedule_cron_dup AS
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
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM schedule
      )
      WHERE rn > 1
    `.execute(trx);
    await sql`DELETE FROM schedule_run WHERE schedule_id IN (SELECT id FROM schedule_cron_dup)`.execute(trx);
    await sql`DELETE FROM schedule WHERE id IN (SELECT id FROM schedule_cron_dup)`.execute(trx);
    await sql`DROP TABLE schedule_cron_dup`.execute(trx);

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
