import { sql, type Kysely } from 'kysely';

/**
 * Configured skills for SQLite (canonical DDL owner).
 * Mirrors the Postgres `skill` table: manifest is BLOB SQLite JSONB
 * (via jsonb(...)), timestamps are ISO-8601 TEXT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE skill (
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      manifest BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, name)
    ) STRICT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS skill`.execute(db);
}
