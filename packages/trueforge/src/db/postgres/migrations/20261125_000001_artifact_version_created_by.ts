import { sql, type Kysely } from 'kysely';

/** Record the session and agent that created each artifact version; existing rows inherit the artifact's. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ADD COLUMN created_by_session_id text,
      ADD COLUMN created_by_agent_id text
  `.execute(db);
  await sql`
    UPDATE artifact_version v
    SET created_by_session_id = a.created_by_session_id, created_by_agent_id = a.created_by_agent_id
    FROM artifact a
    WHERE a.id = v.artifact_id
  `.execute(db);
  await sql`ALTER TABLE artifact_version ALTER COLUMN created_by_session_id SET NOT NULL`.execute(db);
  await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS artifact_version_session_idx`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      DROP COLUMN IF EXISTS created_by_agent_id,
      DROP COLUMN IF EXISTS created_by_session_id
  `.execute(db);
}
