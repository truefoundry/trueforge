import { sql, type Kysely } from 'kysely';

/**
 * Published artifacts — mirrors the Postgres migration. JSON subjects are BLOB JSONB,
 * timestamps are ISO TEXT, and tables are STRICT. The migration owns its transaction
 * because Kysely's migrator does not wrap SQLite DDL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE artifact (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        latest_version INTEGER NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);

    await sql`CREATE UNIQUE INDEX artifact_slug_uq ON artifact (tenant_id, slug)`.execute(trx);
    await sql`CREATE INDEX artifact_list_idx ON artifact (tenant_id, updated_at DESC, id DESC)`.execute(trx);

    await sql`
      CREATE TABLE artifact_version (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES artifact (id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        entry_path TEXT NOT NULL,
        entry_content_type TEXT NOT NULL CHECK (entry_content_type IN ('html', 'markdown')),
        file_count INTEGER NOT NULL,
        total_size_bytes INTEGER NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        source_root TEXT NOT NULL,
        note TEXT,
        storage_backend TEXT NOT NULL CHECK (storage_backend IN ('local', 's3')),
        storage_location TEXT NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX artifact_version_number_uq ON artifact_version (artifact_id, version)
    `.execute(trx);
    await sql`
      CREATE INDEX artifact_version_session_idx ON artifact_version (tenant_id, session_id)
    `.execute(trx);

    await sql`
      CREATE TABLE artifact_file (
        artifact_version_id TEXT NOT NULL REFERENCES artifact_version (id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        media_type TEXT NOT NULL,
        PRIMARY KEY (artifact_version_id, path)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS artifact_file`.execute(trx);
    await sql`DROP TABLE IF EXISTS artifact_version`.execute(trx);
    await sql`DROP TABLE IF EXISTS artifact`.execute(trx);
  });
}
