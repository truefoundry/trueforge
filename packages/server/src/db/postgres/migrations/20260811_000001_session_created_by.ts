import { sql, type Kysely } from 'kysely';

/** Add immutable `created_by` identity on session. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('session')
    .addColumn('created_by', 'text', col => col.notNull().defaultTo(''))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').dropColumn('created_by').execute();
}
