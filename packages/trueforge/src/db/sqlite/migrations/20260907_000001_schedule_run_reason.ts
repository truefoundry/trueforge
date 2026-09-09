import { sql, type Kysely } from 'kysely';

/**
 * Optional failure detail on `schedule_run`. Null unless status is `failed`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule_run ADD COLUMN reason TEXT`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule_run DROP COLUMN reason`.execute(trx);
  });
}
