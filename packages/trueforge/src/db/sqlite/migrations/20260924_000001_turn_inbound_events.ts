import { type Kysely, sql } from 'kysely';

/**
 * Turn-scoped inbound send-event inbox (tip HITL / policies).
 * `turn_id` is required — every row belongs to a tip.
 * Kysely does not wrap SQLite migrations — keep CREATE TABLE + INDEX atomic.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE turn_inbound_events (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        payload BLOB NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, event_id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX turn_inbound_events_unconsumed_idx
        ON turn_inbound_events (session_id, turn_id, event_id)
        WHERE consumed = 0
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS turn_inbound_events_unconsumed_idx`.execute(trx);
    await sql`DROP TABLE IF EXISTS turn_inbound_events`.execute(trx);
  });
}
