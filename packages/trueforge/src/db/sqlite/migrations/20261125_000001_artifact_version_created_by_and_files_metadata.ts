import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261125_000001_artifact_version_created_by_and_files_metadata.ts.
 * Rebuild: ADD COLUMN cannot add a NOT NULL column without a default.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE artifact_version_new (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        files_metadata BLOB NOT NULL,
        created_at TEXT NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_by_session_id TEXT NOT NULL,
        created_by_agent_id TEXT,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifact (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`
      INSERT INTO artifact_version_new (
        artifact_id,
        version,
        files_metadata,
        created_at,
        created_by_subject,
        created_by_session_id,
        created_by_agent_id
      )
      SELECT
        v.artifact_id,
        v.version,
        jsonb(json_object(
          'entry_point', v.entry_point,
          'total_bytes', v.total_bytes,
          'storage_prefix', 'artifacts/' || a.tenant_id || '/' || v.artifact_id || '/' || v.version
        )),
        v.created_at,
        a.created_by_subject,
        a.created_by_session_id,
        a.created_by_agent_id
      FROM artifact_version v
      JOIN artifact a ON a.id = v.artifact_id
    `.execute(trx);

    await sql`DROP TABLE artifact_version`.execute(trx);
    await sql`ALTER TABLE artifact_version_new RENAME TO artifact_version`.execute(trx);
    await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE artifact_version_old (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        entry_point TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifact (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`
      INSERT INTO artifact_version_old (artifact_id, version, entry_point, total_bytes, created_at)
      SELECT
        artifact_id,
        version,
        json_extract(files_metadata, '$.entry_point'),
        json_extract(files_metadata, '$.total_bytes'),
        created_at
      FROM artifact_version
    `.execute(trx);

    await sql`DROP TABLE artifact_version`.execute(trx);
    await sql`ALTER TABLE artifact_version_old RENAME TO artifact_version`.execute(trx);
  });
}
