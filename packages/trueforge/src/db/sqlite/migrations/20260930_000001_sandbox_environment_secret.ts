import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ } from '../../indexes';

/** Per-environment Daytona secret refs (SQLite). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE sandbox_environment_secret (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        external_secret_name TEXT NOT NULL,
        external_secret_id TEXT NOT NULL,
        description TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id),
        FOREIGN KEY (environment_id) REFERENCES sandbox_environment (id) ON DELETE CASCADE
      ) STRICT
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ)}
        ON sandbox_environment_secret (environment_id, secret_name)
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ)}`.execute(trx);
      await sql`DROP TABLE IF EXISTS sandbox_environment_secret`.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
