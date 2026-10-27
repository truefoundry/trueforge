import { sql, type Kysely } from 'kysely';
import {
  SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX,
  SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ,
  SANDBOX_ENVIRONMENT_VERSION_UQ,
} from '../../indexes';

/**
 * Versioned sandbox environments for SQLite (mirrors Postgres).
 * STRICT tables; jsonb as BLOB; timestamps as ISO TEXT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE sandbox_environment (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        active_version INTEGER NOT NULL,
        lifecycle_stage TEXT NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)}
        ON sandbox_environment (tenant_id, name)
        WHERE lifecycle_stage = 'active'
    `.execute(trx);

    await sql`
      CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}
        ON sandbox_environment (tenant_id, json_extract(created_by_subject, '$.subject_id'))
    `.execute(trx);

    await sql`
      CREATE TABLE sandbox_environment_version (
        id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        manifest BLOB NOT NULL,
        status TEXT NOT NULL,
        status_reason TEXT,
        external_ref TEXT NOT NULL,
        internal_metadata BLOB NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id),
        FOREIGN KEY (environment_id) REFERENCES sandbox_environment (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_VERSION_UQ)}
        ON sandbox_environment_version (environment_id, version)
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`DROP TABLE IF EXISTS sandbox_environment_version`.execute(trx);
      await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
      await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)}`.execute(trx);
      await sql`DROP TABLE IF EXISTS sandbox_environment`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
