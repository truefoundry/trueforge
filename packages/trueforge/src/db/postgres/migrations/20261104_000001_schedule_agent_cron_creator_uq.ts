import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_CRON_CREATOR_UQ } from '../../indexes';

/**
 * One creator may not schedule the same agent twice on the same cron:
 * UNIQUE (tenant_id, agent_name, manifest.cron, created_by_subject.subject_id).
 *
 * Existing duplicates are deleted first, keeping the oldest schedule per group
 * (its runs cascade), so the index can be built.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    DELETE FROM schedule AS s
    USING (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY tenant_id, agent_name, manifest->>'cron', created_by_subject->>'subject_id'
          ORDER BY created_at, id
        ) AS rn
      FROM schedule
    ) AS d
    WHERE s.id = d.id
      AND d.rn > 1
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}
      ON schedule (tenant_id, agent_name, (manifest->>'cron'), (created_by_subject->>'subject_id'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_CRON_CREATOR_UQ)}`.execute(db);
}
