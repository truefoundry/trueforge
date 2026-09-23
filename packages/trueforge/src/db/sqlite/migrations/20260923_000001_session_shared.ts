import { sql, type Kysely } from 'kysely';

/**
 * Tenant-visible share flag. Existing sessions stay private.
 * Mirrors db/postgres/migrations/20260923_000001_session_shared.ts.
 * Kysely does not wrap SQLite migrations — keep schema changes in a transaction.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE session
        ADD COLUMN shared INTEGER NOT NULL DEFAULT 0
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session DROP COLUMN shared`.execute(trx);
  });
}
