import { sql, type Kysely } from 'kysely';
import { ARTIFACT_LIST_IDX, ARTIFACT_SESSION_IDX, ARTIFACT_TENANT_SLUG_UQ } from '../../indexes';

/**
 * Versioned artifacts for SQLite (mirrors Postgres).
 * STRICT tables; jsonb as BLOB; timestamps as ISO TEXT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE artifact (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        latest_version INTEGER NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_by_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT ${sql.raw(ARTIFACT_TENANT_SLUG_UQ)} UNIQUE (tenant_id, slug)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE INDEX ${sql.raw(ARTIFACT_LIST_IDX)}
        ON artifact (tenant_id, updated_at DESC, id)
    `.execute(trx);

    await sql`
      CREATE INDEX ${sql.raw(ARTIFACT_SESSION_IDX)}
        ON artifact (tenant_id, created_by_session_id)
    `.execute(trx);

    await sql`
      CREATE TABLE artifact_version (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        entrypoint TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_by_session_id TEXT NOT NULL,
        created_by_turn_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifact (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE TABLE artifact_file (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version, path),
        FOREIGN KEY (artifact_id, version) REFERENCES artifact_version (artifact_id, version) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`DROP TABLE IF EXISTS artifact_file`.execute(trx);
      await sql`DROP TABLE IF EXISTS artifact_version`.execute(trx);
      await sql`DROP TABLE IF EXISTS artifact`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
