import { sql, type Kysely } from 'kysely';

/** Artifact metadata (mirrors Postgres). STRICT tables; jsonb as BLOB; timestamps as ISO TEXT. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE artifact (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        latest_version INTEGER NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_by_session_id TEXT NOT NULL,
        created_by_agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT artifact_tenant_slug_uq UNIQUE (tenant_id, slug)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX artifact_list_idx
        ON artifact (tenant_id, json_extract(created_by_subject, '$.subject_id'), updated_at DESC, id)
    `.execute(trx);
    await sql`CREATE INDEX artifact_session_idx ON artifact (tenant_id, created_by_session_id)`.execute(trx);
    await sql`CREATE INDEX artifact_agent_idx ON artifact (tenant_id, created_by_agent_id)`.execute(trx);
    await sql`
      CREATE TABLE artifact_version (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        entry_point TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifact (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`DROP TABLE IF EXISTS artifact_version`.execute(trx);
      await sql`DROP TABLE IF EXISTS artifact`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
