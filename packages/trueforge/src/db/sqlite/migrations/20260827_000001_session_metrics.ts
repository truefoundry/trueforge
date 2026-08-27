import { sql, type Kysely } from 'kysely';

/**
 * Rebuild `session`: ADD COLUMN cannot take DEFAULT (jsonb(...)) (expression default).
 * DROP TABLE session needs FKs off; PRAGMA foreign_keys is a no-op inside a txn.
 * down also rebuilds — DROP COLUMN rewrites STRICT parents and can CASCADE children.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE session_new (
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          agent_id TEXT,
          agent_name TEXT,
          agent_spec BLOB,
          title TEXT,
          last_turn_id TEXT,
          custom BLOB,
          metrics BLOB NOT NULL DEFAULT (jsonb('{"total_cost_in_usd":0,"total_duration_ms":0,"total_turns":0}')),
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
          created_by,
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          custom,
          metrics,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          session_id,
          created_by,
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          custom,
          jsonb('{"total_cost_in_usd":0,"total_duration_ms":0,"total_turns":0}'),
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
      await sql`
        CREATE INDEX session_list_updated_at_idx
          ON session (tenant_id, updated_at, session_id)
      `.execute(trx);
      await sql`
        CREATE INDEX session_agent_created_at_idx
          ON session (tenant_id, agent_id, created_at)
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
      await sql`
        CREATE TABLE session_old (
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          agent_id TEXT,
          agent_name TEXT,
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
        INSERT INTO session_old (
          tenant_id,
          session_id,
          created_by,
          agent_id,
          agent_name,
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
          created_by,
          agent_id,
          agent_name,
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
      await sql`
        CREATE INDEX session_agent_id_idx
          ON session (tenant_id, agent_id)
          WHERE agent_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE INDEX session_list_updated_at_idx
          ON session (tenant_id, updated_at, session_id)
      `.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
