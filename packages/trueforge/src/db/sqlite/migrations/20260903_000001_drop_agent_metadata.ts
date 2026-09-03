import { type Kysely, sql } from 'kysely';
import { AGENT_EXTERNAL_ID_UQ } from '../../indexes';

/**
 * Drop agent.metadata. Rebuild: ADD/DROP COLUMN cannot take DEFAULT (jsonb(...)) / STRICT drop.
 * Keeps external_id + partial unique index from 20260902_000002.
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
          external_id TEXT,
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
          external_id,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          manifest,
          external_id,
          created_at,
          updated_at
        FROM agent
      `.execute(trx);

      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_new RENAME TO agent`.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(AGENT_EXTERNAL_ID_UQ)}
          ON agent (tenant_id, external_id)
          WHERE external_id IS NOT NULL
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
      await sql`DROP INDEX IF EXISTS ${sql.raw(AGENT_EXTERNAL_ID_UQ)}`.execute(trx);
      await sql`
        CREATE TABLE agent_old (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          metadata BLOB NOT NULL DEFAULT (jsonb('{}')),
          external_id TEXT,
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
          metadata,
          external_id,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          manifest,
          jsonb('{}'),
          external_id,
          created_at,
          updated_at
        FROM agent
      `.execute(trx);

      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_old RENAME TO agent`.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(AGENT_EXTERNAL_ID_UQ)}
          ON agent (tenant_id, external_id)
          WHERE external_id IS NOT NULL
      `.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
