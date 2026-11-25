import { sql, type Kysely } from 'kysely';

/** SQLite mirror of postgres/migrations/20261125_000003_artifact_version_session_idx.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS artifact_version_session_idx`.execute(db);
}
