import { type Kysely, sql } from 'kysely';

/**
 * Session inbound send-event inbox (tip HITL + future session-scoped payloads).
 * `turn_id` column nullable (v1 insert always sets it; null reserved for session-only policies later).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE session_inbound_events (
      session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      turn_id TEXT,
      payload BLOB NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, event_id)
    ) STRICT
  `.execute(db);

  await sql`
    CREATE INDEX session_inbound_events_unconsumed_idx
      ON session_inbound_events (session_id, turn_id, event_id)
      WHERE consumed = 0
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS session_inbound_events_unconsumed_idx`.execute(db);
  await sql`DROP TABLE IF EXISTS session_inbound_events`.execute(db);
}
