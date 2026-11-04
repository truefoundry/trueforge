import { sql, type Kysely } from 'kysely';

/** Add optional caller-authored notes to schedules. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule').addColumn('notes', 'text').execute();
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule').dropColumn('notes').execute();
}
