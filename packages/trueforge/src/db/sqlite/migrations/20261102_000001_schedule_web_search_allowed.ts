import { sql, type Kysely } from 'kysely';

/**
 * Create-time snapshot of the tenant web search switch, mirroring Postgres
 * `schedule.web_search_allowed`. INTEGER 0/1 (STRICT has no boolean).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule ADD COLUMN web_search_allowed INTEGER NOT NULL DEFAULT 1`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE schedule DROP COLUMN web_search_allowed`.execute(trx);
  });
}
