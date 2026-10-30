import { sql, type Kysely } from 'kysely';

/** Per-session memory ingestion checkpoint; removed with the session. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('memory_ingest_cursor')
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('scope_key', 'text', col => col.notNull())
    .addColumn('last_ingested_turn_id', 'text')
    .addColumn('external_thread_id', 'text')
    .addColumn('last_error', 'text')
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('memory_ingest_cursor_pkey', ['session_id'])
    .addForeignKeyConstraint('memory_ingest_cursor_session_fkey', ['session_id'], 'session', ['session_id'], fk =>
      fk.onDelete('cascade'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('memory_ingest_cursor').ifExists().execute();
}
