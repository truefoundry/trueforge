import { sql, type Kysely } from 'kysely';
import { SCHEDULE_CRON_UQ } from '../../indexes';

/**
 * UNIQUE (tenant_id, agent_name, manifest.cron, created_by_subject.subject_id) on schedule.
 *
 * Existing duplicates are deleted first, keeping the oldest schedule of each group; their
 * runs go with them via `ON DELETE CASCADE`. `down` only drops the index — deleted rows
 * are not restored.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  const result = await sql`
    DELETE FROM schedule
    WHERE id IN (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id, agent_name, manifest->>'cron', created_by_subject->>'subject_id'
            ORDER BY created_at ASC, id ASC
          ) AS rank
        FROM schedule
      ) AS ranked
      WHERE ranked.rank > 1
    )
  `.execute(db);
  console.log(`schedule-cron-uq migration: deleted_duplicates=${String(result.numAffectedRows ?? 0n)}`);
  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_CRON_UQ)}
      ON schedule (tenant_id, agent_name, (manifest->>'cron'), (created_by_subject->>'subject_id'))
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CRON_UQ)}`.execute(db);
}
