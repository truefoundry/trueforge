import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261030_000001_memory_ingest_cursor.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE memory_ingest_cursor (
        session_id TEXT NOT NULL PRIMARY KEY REFERENCES session(session_id) ON DELETE CASCADE,
        scope_key TEXT NOT NULL,
        last_ingested_turn_id TEXT,
        external_thread_id TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS memory_ingest_cursor`.execute(trx);
  });
}
