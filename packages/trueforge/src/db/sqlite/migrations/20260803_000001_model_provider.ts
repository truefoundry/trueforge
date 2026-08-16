import { sql, type Kysely } from 'kysely';

/**
 * Configured model providers for SQLite (canonical DDL owner).
 * Mirrors the Postgres `model_provider` table: manifest is BLOB SQLite JSONB
 * (via jsonb(...)), timestamps are ISO-8601 TEXT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE model_provider (
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        manifest BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, name)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS model_provider`.execute(trx);
  });
}
