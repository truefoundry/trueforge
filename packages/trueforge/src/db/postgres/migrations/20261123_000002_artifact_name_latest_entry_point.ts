import { sql, type Kysely } from 'kysely';

/** Rename artifact.title to name; add latest_entry_point, which the store sets on each new version. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact RENAME COLUMN title TO name`.execute(db);
  await sql`ALTER TABLE artifact ADD COLUMN latest_entry_point text`.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact DROP COLUMN IF EXISTS latest_entry_point`.execute(db);
  await sql`ALTER TABLE artifact RENAME COLUMN name TO title`.execute(db);
}
