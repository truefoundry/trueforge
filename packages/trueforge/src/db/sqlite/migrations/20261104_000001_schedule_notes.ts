import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261104_000001_schedule_notes.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule ADD COLUMN notes TEXT`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule DROP COLUMN notes`.execute(trx);
  });
}
