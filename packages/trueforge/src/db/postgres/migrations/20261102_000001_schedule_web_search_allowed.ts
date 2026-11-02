import { sql, type Kysely } from 'kysely';

/**
 * Create-time snapshot of the tenant web search switch on each schedule.
 *
 * Existing schedules were made while web search was on for every tenant, so the
 * default keeps them running after an admin turns the switch off.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('schedule')
    .addColumn('web_search_allowed', 'boolean', col => col.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule').dropColumn('web_search_allowed').execute();
}
