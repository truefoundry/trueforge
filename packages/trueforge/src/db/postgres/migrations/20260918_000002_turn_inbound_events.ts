import { sql, type Kysely } from 'kysely';

/**
 * Turn-scoped inbound send-event inbox (tip HITL / policies).
 * `turn_id` is required — every row belongs to a tip.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('turn_inbound_events')
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('turn_id', 'text', col => col.notNull())
    .addColumn('event_id', 'text', col => col.notNull())
    .addColumn('payload', 'jsonb', col => col.notNull())
    .addColumn('consumed', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('turn_inbound_events_pkey', ['session_id', 'turn_id', 'event_id'])
    .execute();

  await db.schema
    .alterTable('turn_inbound_events')
    .addForeignKeyConstraint('turn_inbound_events_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  await sql`
    CREATE INDEX turn_inbound_events_unconsumed_idx
      ON turn_inbound_events (session_id, turn_id, event_id)
      WHERE consumed = false
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('turn_inbound_events').ifExists().cascade().execute();
}
