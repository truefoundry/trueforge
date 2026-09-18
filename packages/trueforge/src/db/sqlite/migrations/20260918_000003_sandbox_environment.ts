import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX, SANDBOX_ENVIRONMENT_TENANT_NAME_UQ } from '../../indexes';

/**
 * Owned sandbox environments for SQLite — mirrors
 * db/postgres/migrations/20260918_000002_sandbox_environment.ts.
 *
 * SQLite differences: `manifest` / `created_by_subject` are BLOB JSONB, timestamps
 * are ISO TEXT, table is STRICT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE sandbox_environment (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        manifest BLOB NOT NULL,
        created_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_UQ)}
        ON sandbox_environment (tenant_id, name)
    `.execute(trx);

    await sql`
      CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}
        ON sandbox_environment (tenant_id, json_extract(created_by_subject, '$.subject_id'))
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_UQ)}`.execute(trx);
    await sql`DROP TABLE IF EXISTS sandbox_environment`.execute(trx);
  });
}
