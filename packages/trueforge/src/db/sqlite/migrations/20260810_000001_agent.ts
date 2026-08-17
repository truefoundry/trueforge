import { sql, type Kysely } from 'kysely';

/**
 * Agent registry + session agent binding for SQLite.
 *
 * - `agent`: mirrors Postgres (manifest is BLOB SQLite JSONB; timestamps ISO TEXT).
 * - `session`: agent_id XOR agent_spec. STRICT cannot drop NOT NULL in place —
 *   rebuild the session table. Child rows keep matching session_id values.
 *
 * `DROP TABLE session` needs FKs off (`turn` etc. still REFERENCES it).
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so toggle it around the
 * txn (Kysely Migrator does not wrap SQLite migrations — see kysely#56).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE agent (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          UNIQUE (tenant_id, name)
        ) STRICT
      `.execute(trx);

      await sql`
        CREATE TABLE session_new (
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          agent_id TEXT,
          agent_spec BLOB,
          title TEXT,
          last_turn_id TEXT,
          custom BLOB,
          last_activity_timestamp_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id),
          CHECK (
            (agent_id IS NOT NULL AND agent_spec IS NULL)
            OR (agent_id IS NULL AND agent_spec IS NOT NULL)
          )
        ) STRICT
      `.execute(trx);

      await sql`
        INSERT INTO session_new (
          tenant_id,
          session_id,
          agent_id,
          agent_spec,
          title,
          last_turn_id,
          custom,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          session_id,
          NULL,
          agent_spec,
          title,
          last_turn_id,
          custom,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        FROM session
      `.execute(trx);

      await sql`DROP TABLE session`.execute(trx);
      await sql`ALTER TABLE session_new RENAME TO session`.execute(trx);

      await sql`
        CREATE INDEX session_list_idx
          ON session (tenant_id, created_at, session_id)
      `.execute(trx);

      await sql`
        CREATE INDEX session_agent_id_idx
          ON session (tenant_id, agent_id)
          WHERE agent_id IS NOT NULL
      `.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`DELETE FROM session WHERE agent_spec IS NULL`.execute(trx);

      await sql`
        CREATE TABLE session_old (
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
        INSERT INTO session_old (
          tenant_id,
          session_id,
          agent_spec,
          title,
          last_turn_id,
          custom,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          session_id,
          agent_spec,
          title,
          last_turn_id,
          custom,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        FROM session
      `.execute(trx);

      await sql`DROP TABLE session`.execute(trx);
      await sql`ALTER TABLE session_old RENAME TO session`.execute(trx);

      await sql`
        CREATE INDEX session_list_idx
          ON session (tenant_id, created_at, session_id)
      `.execute(trx);

      await sql`DROP TABLE IF EXISTS agent`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
