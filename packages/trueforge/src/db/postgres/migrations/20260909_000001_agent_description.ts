import { sql, type Kysely } from 'kysely';

/** Add agent `description`; backfill existing rows from `name`. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('agent')
    .addColumn('description', 'text', col => col.notNull().defaultTo(''))
    .execute();
  await sql`UPDATE agent SET description = name`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('agent').dropColumn('description').execute();
}
