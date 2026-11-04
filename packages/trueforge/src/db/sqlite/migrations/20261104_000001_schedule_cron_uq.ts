import { sql, type Kysely } from 'kysely';
import { SCHEDULE_CRON_UQ } from '../../indexes';

/**
 * UNIQUE (tenant_id, agent_name, manifest.cron, created_by_subject.subject_id) on schedule.
 * Mirrors db/postgres/migrations/20261104_000001_schedule_cron_uq.ts: duplicates are deleted
 * first, keeping the oldest schedule of each group (runs cascade). `down` only drops the index.
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
            ROW_NUMBER() OVER (
              PARTITION BY
                tenant_id,
                agent_name,
                json_extract(manifest, '$.cron'),
                json_extract(created_by_subject, '$.subject_id')
              ORDER BY created_at ASC, id ASC
            ) AS rank
          FROM schedule
        )
        WHERE rank > 1
      )
    `.execute(trx);
    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_CRON_UQ)}
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
    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CRON_UQ)}`.execute(trx);
  });
}
