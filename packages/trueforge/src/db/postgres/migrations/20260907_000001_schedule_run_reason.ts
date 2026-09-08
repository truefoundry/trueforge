import { sql, type Kysely } from 'kysely';

/**
 * Optional failure detail on `schedule_run`. Null unless status is `failed`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule_run').addColumn('reason', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule_run').dropColumn('reason').execute();
}
