import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261104_000001_schedule_notes.ts. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule ADD COLUMN notes TEXT`.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule DROP COLUMN notes`.execute(trx);
  });
}
