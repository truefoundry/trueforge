import { sql, type Kysely } from 'kysely';

/**
 * Stamp `metadata["tfg.source"] = "schedule"` on schedule-run sessions (`source.type = 'schedule'`)
 * so source counts include them. `updated_at` is left untouched so list ordering does not change.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session
    SET metadata = metadata || jsonb_build_object('tfg.source', 'schedule')
    WHERE source->>'type' = 'schedule'
      AND metadata->'tfg.source' IS NULL
  `.execute(db);
}

/** Data backfill — not reversed: backfilled rows are indistinguishable from rows stamped at creation. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261112_000001_session_tfg_source_schedule_backfill is irreversible'));
}
