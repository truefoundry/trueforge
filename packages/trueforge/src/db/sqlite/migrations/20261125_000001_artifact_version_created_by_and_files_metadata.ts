import { sql, type Kysely } from 'kysely';

/** SQLite mirror of postgres/migrations/20261125_000001_artifact_version_created_by_and_files_metadata.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE artifact_version`.execute(trx);
    await sql`DELETE FROM artifact`.execute(trx);
    await sql`
      CREATE TABLE artifact_version (
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
    await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE artifact_version`.execute(trx);
    await sql`DELETE FROM artifact`.execute(trx);
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
