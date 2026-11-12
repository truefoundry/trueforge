import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261112_000001_session_tfg_source_schedule_backfill.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session
      SET metadata = jsonb_set(metadata, '$."tfg.source"', 'schedule')
      WHERE json_extract(source, '$.type') = 'schedule'
        AND json_extract(metadata, '$."tfg.source"') IS NULL
    `.execute(trx);
  });
}

/** Data backfill — not reversed: backfilled rows are indistinguishable from rows stamped at creation. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261112_000001_session_tfg_source_schedule_backfill is irreversible'));
}
