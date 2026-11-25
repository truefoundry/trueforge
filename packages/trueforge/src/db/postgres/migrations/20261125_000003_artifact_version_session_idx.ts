import { sql, type Kysely } from 'kysely';

/** Index for listing the artifacts a session created versions of. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS artifact_version_session_idx`.execute(db);
}
