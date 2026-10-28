import { sql, type Kysely } from 'kysely';

/**
 * Stamp `metadata["tfg.source"] = "ui"` on pre-existing interactive sessions so Chat History,
 * which now lists only sessions carrying that key, keeps showing them.
 *
 * Schedule runs are the only sessions with `external_id`; checking it alongside `source` also
 * skips schedule runs created before `source` existed. `updated_at` is left untouched so list
 * ordering does not change.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session
    SET metadata = metadata || jsonb_build_object('tfg.source', 'ui')
    WHERE source IS NULL
      AND external_id IS NULL
      AND metadata->'tfg.source' IS NULL
  `.execute(db);
}

/** Data backfill — not reversed: backfilled rows are indistinguishable from UI-stamped ones. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261028_000001_session_tfg_source_backfill is irreversible'));
}
