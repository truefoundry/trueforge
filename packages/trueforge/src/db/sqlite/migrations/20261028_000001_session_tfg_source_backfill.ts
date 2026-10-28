import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261028_000001_session_tfg_source_backfill.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session
      SET metadata = jsonb_set(metadata, '$."tfg.source"', 'ui')
      WHERE source IS NULL
        AND external_id IS NULL
        AND json_extract(metadata, '$."tfg.source"') IS NULL
    `.execute(trx);
  });
}

/** Data backfill — not reversed: backfilled rows are indistinguishable from UI-stamped ones. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261028_000001_session_tfg_source_backfill is irreversible'));
}
