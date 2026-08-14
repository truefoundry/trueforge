import { type Kysely, sql } from 'kysely';

/**
 * Session-store tables for SQLite (canonical DDL owner).
 *
 * JSON payload columns are BLOB holding SQLite JSONB (via jsonb(...)).
 * Timestamps are ISO-8601 TEXT. Context order is turn_thread_context (not an array column).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE session (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_spec BLOB NOT NULL,
        title TEXT,
        last_turn_id TEXT,
        custom BLOB,
        last_activity_timestamp_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX session_list_idx
        ON session (tenant_id, created_at, session_id)
    `.execute(trx);

    await sql`
      CREATE TABLE turn (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        first_turn_id TEXT NOT NULL,
        previous_turn_id TEXT,
        ancestor_ids BLOB NOT NULL,
        input BLOB NOT NULL,
        state BLOB NOT NULL,
        checkpoint BLOB NOT NULL,
        custom BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX turn_list_idx
        ON turn (session_id, created_at, turn_id)
    `.execute(trx);

    await sql`
      CREATE TABLE turn_thread (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        checkpoint BLOB NOT NULL,
        agent_info BLOB,
        current_context_usage BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, thread_id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE TABLE turn_thread_context (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        pos INTEGER NOT NULL,
        append_id INTEGER NOT NULL,
        PRIMARY KEY (session_id, turn_id, thread_id, pos)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX turn_thread_context_append_idx
        ON turn_thread_context (session_id, thread_id, append_id)
    `.execute(trx);

    await sql`
      CREATE TABLE session_event (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, event_id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE TABLE thread_context_log (
        append_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        body BLOB NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX thread_context_log_lookup_idx
        ON thread_context_log (session_id, thread_id, append_id)
    `.execute(trx);

    await sql`
      CREATE TABLE thread_capability_state (
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        key TEXT NOT NULL,
        state BLOB,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, thread_id, key)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS thread_capability_state`.execute(trx);
    await sql`DROP TABLE IF EXISTS thread_context_log`.execute(trx);
    await sql`DROP TABLE IF EXISTS session_event`.execute(trx);
    await sql`DROP TABLE IF EXISTS turn_thread_context`.execute(trx);
    await sql`DROP TABLE IF EXISTS turn_thread`.execute(trx);
    await sql`DROP TABLE IF EXISTS turn`.execute(trx);
    await sql`DROP TABLE IF EXISTS session`.execute(trx);
  });
}
