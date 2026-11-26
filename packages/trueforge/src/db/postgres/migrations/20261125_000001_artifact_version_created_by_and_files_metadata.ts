import { sql, type Kysely } from 'kysely';

/**
 * Record the subject, session and agent that created each artifact version, and fold `entry_point` and
 * `total_bytes` into `files_metadata` jsonb with a `storage_prefix`. The feature is not live, so both
 * directions drop existing artifacts instead of backfilling.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DELETE FROM artifact`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      DROP COLUMN entry_point,
      DROP COLUMN total_bytes,
      ADD COLUMN files_metadata jsonb NOT NULL,
      ADD COLUMN created_by_subject jsonb NOT NULL,
      ADD COLUMN created_by_session_id text NOT NULL,
      ADD COLUMN created_by_agent_id text
  `.execute(db);
  await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DELETE FROM artifact`.execute(db);
  await sql`DROP INDEX IF EXISTS artifact_version_session_idx`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      DROP COLUMN files_metadata,
      DROP COLUMN created_by_subject,
      DROP COLUMN created_by_session_id,
      DROP COLUMN created_by_agent_id,
      ADD COLUMN entry_point text NOT NULL,
      ADD COLUMN total_bytes bigint NOT NULL
  `.execute(db);
}
