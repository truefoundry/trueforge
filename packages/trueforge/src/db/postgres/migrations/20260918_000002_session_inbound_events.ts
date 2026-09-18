import { sql, type Kysely } from 'kysely';

/**
 * Session inbound send-event inbox (tip HITL + future session-scoped payloads).
 * `turn_id` column nullable (v1 insert always sets it; null reserved for session-only policies later).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('session_inbound_events')
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('event_id', 'text', col => col.notNull())
    .addColumn('turn_id', 'text')
    .addColumn('payload', 'jsonb', col => col.notNull())
    .addColumn('consumed', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('session_inbound_events_pkey', ['session_id', 'event_id'])
    .execute();

  await db.schema
    .alterTable('session_inbound_events')
    .addForeignKeyConstraint('session_inbound_events_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  await sql`
    CREATE INDEX session_inbound_events_unconsumed_idx
      ON session_inbound_events (session_id, turn_id, event_id)
      WHERE consumed = false
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('session_inbound_events').ifExists().cascade().execute();
}
