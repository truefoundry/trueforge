import { sql, type Kysely } from 'kysely';

/** Rename artifact.title to name; persist the latest version's entry point on the artifact row. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact RENAME COLUMN title TO name`.execute(db);
  await sql`ALTER TABLE artifact ADD COLUMN latest_entry_point text`.execute(db);
  await sql`
    UPDATE artifact a
    SET latest_entry_point = v.entry_point
    FROM artifact_version v
    WHERE v.artifact_id = a.id AND v.version = a.latest_version
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact DROP COLUMN IF EXISTS latest_entry_point`.execute(db);
  await sql`ALTER TABLE artifact RENAME COLUMN name TO title`.execute(db);
}
