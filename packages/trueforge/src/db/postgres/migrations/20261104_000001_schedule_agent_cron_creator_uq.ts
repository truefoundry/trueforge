import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_CRON_CREATOR_UQ } from '../../indexes';

/**
 * One schedule per `(agent, cron, creator)`: UNIQUE (tenant_id, agent_name, manifest->>'cron',
 * created_by_subject->>'subject_id').
 *
 * Existing duplicates keep the oldest row (`created_at`, then `id`); newer ones are deleted
 * with their runs, so `down` cannot restore them.
 * Runs inside the Migrator's transaction — do not nest `db.transaction()`.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    DELETE FROM schedule AS s
    USING (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY tenant_id, agent_name, manifest->>'cron', created_by_subject->>'subject_id'
          ORDER BY created_at, id
        ) AS rn
      FROM schedule
    ) AS ranked
    WHERE s.id = ranked.id
      AND ranked.rn > 1;

    CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}
      ON schedule (tenant_id, agent_name, (manifest->>'cron'), (created_by_subject->>'subject_id'));
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)};
  `.execute(db);
}
