import { sql, type Kysely } from 'kysely';

/**
 * Per-session memory ingestion checkpoint. No foreign key to `session`: the row outlives a deleted
 * session so its provider thread can still be cleaned up.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('memory_ingest_cursor')
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('last_ingested_turn_id', 'text')
    .addColumn('external_thread_id', 'text')
    .addColumn('last_error', 'text')
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('memory_ingest_cursor_pkey', ['session_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('memory_ingest_cursor').ifExists().execute();
}
