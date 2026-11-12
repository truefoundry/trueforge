import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261027_000001_access_control.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE access_control (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        granted_by_subject BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, session_id, subject_type, subject_id)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS access_control`.execute(trx);
  });
}
