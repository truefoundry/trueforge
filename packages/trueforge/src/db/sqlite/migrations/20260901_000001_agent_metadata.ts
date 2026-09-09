import { sql, type Kysely } from 'kysely';

/**
 * Agent registry metadata jsonb column. Mirrors Postgres.
 * Rebuild: ADD/DROP COLUMN cannot take DEFAULT (jsonb(...)) / STRICT drop.
 * DROP TABLE agent needs FKs off (`schedule` REFERENCES it).
 * PRAGMA foreign_keys is a no-op inside a txn.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE agent_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          metadata BLOB NOT NULL DEFAULT (jsonb('{}')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          UNIQUE (tenant_id, name)
        ) STRICT
      `.execute(trx);

      await sql`
        INSERT INTO agent_new (
          id,
          tenant_id,
          name,
          manifest,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          manifest,
          jsonb('{}'),
          created_at,
          updated_at
        FROM agent
      `.execute(trx);

      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_new RENAME TO agent`.execute(trx);
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
        CREATE TABLE agent_old (
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
        INSERT INTO agent_old (
          id,
          tenant_id,
          name,
          manifest,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          manifest,
          created_at,
          updated_at
        FROM agent
      `.execute(trx);

      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_old RENAME TO agent`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
