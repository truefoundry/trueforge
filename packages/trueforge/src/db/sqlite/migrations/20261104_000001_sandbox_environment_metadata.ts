import { sql, type Kysely } from 'kysely';
import {
  SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX,
  SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ,
} from '../../indexes';

async function createIndexes(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)}
      ON sandbox_environment (tenant_id, name)
      WHERE lifecycle_stage = 'active'
  `.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}
      ON sandbox_environment (tenant_id, json_extract(created_by_subject, '$.subject_id'))
  `.execute(db);
}

/** Add caller-owned metadata to sandbox environments. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE sandbox_environment_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          metadata BLOB NOT NULL DEFAULT (jsonb('{}')) CHECK (json_type(metadata) = 'object'),
          active_version INTEGER NOT NULL,
          lifecycle_stage TEXT NOT NULL,
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id)
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO sandbox_environment_new (
          id,
          tenant_id,
          name,
          description,
          metadata,
          active_version,
          lifecycle_stage,
          created_by_subject,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          description,
          jsonb('{}'),
          active_version,
          lifecycle_stage,
          created_by_subject,
          created_at,
          updated_at
        FROM sandbox_environment
      `.execute(trx);
      await sql`DROP TABLE sandbox_environment`.execute(trx);
      await sql`ALTER TABLE sandbox_environment_new RENAME TO sandbox_environment`.execute(trx);
      await createIndexes(trx);
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
        CREATE TABLE sandbox_environment_old (
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
        INSERT INTO sandbox_environment_old (
          id,
          tenant_id,
          name,
          description,
          active_version,
          lifecycle_stage,
          created_by_subject,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          name,
          description,
          active_version,
          lifecycle_stage,
          created_by_subject,
          created_at,
          updated_at
        FROM sandbox_environment
      `.execute(trx);
      await sql`DROP TABLE sandbox_environment`.execute(trx);
      await sql`ALTER TABLE sandbox_environment_old RENAME TO sandbox_environment`.execute(trx);
      await createIndexes(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
