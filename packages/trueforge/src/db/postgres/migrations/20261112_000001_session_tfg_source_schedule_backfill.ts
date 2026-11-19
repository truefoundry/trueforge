import { sql, type Kysely } from 'kysely';

/**
 * Stamp `metadata["tfg.source"] = "schedule"` on schedule-run sessions.
 * Runs predating `session.source` are matched via `schedule_run`, not `external_id`, which API callers can set.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session
    SET metadata = metadata || jsonb_build_object('tfg.source', 'schedule')
    WHERE (
      source->>'type' = 'schedule'
      OR EXISTS (
        SELECT 1
        FROM schedule_run AS r
        WHERE r.tenant_id = session.tenant_id
          AND r.session_id = session.session_id
      )
    )
    AND metadata->'tfg.source' IS NULL
  `.execute(db);
}

/** Irreversible: backfilled rows are indistinguishable from rows stamped at creation. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261112_000001_session_tfg_source_schedule_backfill is irreversible'));
}
