import { sql, type Kysely, type Transaction } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261123_000001_drop_artifact_slug.ts.
 * Rebuild: DROP COLUMN cannot drop a column in a UNIQUE constraint.
 * DROP TABLE artifact needs FKs off (`artifact_version` REFERENCES it).
 * PRAGMA foreign_keys is a no-op inside a txn.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE artifact_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          title TEXT NOT NULL,
          latest_version INTEGER NOT NULL,
          created_by_subject BLOB NOT NULL,
          created_by_session_id TEXT NOT NULL,
          created_by_agent_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id)
        ) STRICT
      `.execute(trx);

      await sql`
        INSERT INTO artifact_new (
          id,
          tenant_id,
          title,
          latest_version,
          created_by_subject,
          created_by_session_id,
          created_by_agent_id,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          title,
          latest_version,
          created_by_subject,
          created_by_session_id,
          created_by_agent_id,
          created_at,
          updated_at
        FROM artifact
      `.execute(trx);

      await sql`DROP TABLE artifact`.execute(trx);
      await sql`ALTER TABLE artifact_new RENAME TO artifact`.execute(trx);
      await createArtifactIndexes(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}

/** Original slugs are not recoverable; the id is unique, so it backfills the restored constraint. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE artifact_old (
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
        INSERT INTO artifact_old (
          id,
          tenant_id,
          slug,
          title,
          latest_version,
          created_by_subject,
          created_by_session_id,
          created_by_agent_id,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          id,
          title,
          latest_version,
          created_by_subject,
          created_by_session_id,
          created_by_agent_id,
          created_at,
          updated_at
        FROM artifact
      `.execute(trx);

      await sql`DROP TABLE artifact`.execute(trx);
      await sql`ALTER TABLE artifact_old RENAME TO artifact`.execute(trx);
      await createArtifactIndexes(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}

async function createArtifactIndexes(trx: Transaction<unknown>): Promise<void> {
  await sql`
    CREATE INDEX artifact_list_idx
      ON artifact (tenant_id, json_extract(created_by_subject, '$.subject_id'), updated_at DESC, id)
  `.execute(trx);
  await sql`CREATE INDEX artifact_session_idx ON artifact (tenant_id, created_by_session_id)`.execute(trx);
  await sql`CREATE INDEX artifact_agent_idx ON artifact (tenant_id, created_by_agent_id)`.execute(trx);
}
