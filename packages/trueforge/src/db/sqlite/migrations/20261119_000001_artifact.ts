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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT artifact_tenant_slug_uq UNIQUE (tenant_id, slug)
      ) STRICT
    `.execute(trx);

    await sql`CREATE INDEX artifact_list_idx ON artifact (tenant_id, updated_at DESC, id)`.execute(trx);
    await sql`CREATE INDEX artifact_session_idx ON artifact (tenant_id, created_by_session_id)`.execute(trx);

    await sql`
      CREATE TABLE artifact_version (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        entrypoint TEXT NOT NULL,
        created_by_turn_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifact (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`CREATE INDEX artifact_version_status_idx ON artifact_version (artifact_id, status)`.execute(trx);

    await sql`
      CREATE TABLE artifact_file (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version, path),
        FOREIGN KEY (artifact_id, version) REFERENCES artifact_version (artifact_id, version) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);
  });
}
