import { sql, type Kysely } from 'kysely';

/** Add immutable `created_by` identity on session. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE session
        ADD COLUMN created_by TEXT NOT NULL DEFAULT ''
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // SQLite cannot DROP COLUMN under STRICT without a table rebuild; irreversible.
  void db;
  return Promise.reject(new Error('20260811_000001_session_created_by is not reversible'));
}
