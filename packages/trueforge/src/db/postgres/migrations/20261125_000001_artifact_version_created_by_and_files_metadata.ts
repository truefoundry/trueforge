import { sql, type Kysely } from 'kysely';

/**
 * Record the subject, session and agent that created each artifact version, and fold `entry_point` and
 * `total_bytes` into `files_metadata` jsonb with a `storage_prefix`. Existing rows inherit the artifact's
 * creator and get `artifacts/<tenant_id>/<artifact_id>/<version>`; `down` drops `storage_prefix`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ADD COLUMN created_by_subject jsonb,
      ADD COLUMN created_by_session_id text,
      ADD COLUMN created_by_agent_id text,
      ADD COLUMN files_metadata jsonb
  `.execute(db);
  await sql`
    UPDATE artifact_version v
    SET created_by_subject = a.created_by_subject,
        created_by_session_id = a.created_by_session_id,
        created_by_agent_id = a.created_by_agent_id,
        files_metadata = jsonb_build_object(
          'entry_point', v.entry_point,
          'total_bytes', v.total_bytes,
          'storage_prefix', 'artifacts/' || a.tenant_id || '/' || v.artifact_id || '/' || v.version
        )
    FROM artifact a
    WHERE a.id = v.artifact_id
  `.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ALTER COLUMN created_by_subject SET NOT NULL,
      ALTER COLUMN created_by_session_id SET NOT NULL,
      ALTER COLUMN files_metadata SET NOT NULL,
      DROP COLUMN entry_point,
      DROP COLUMN total_bytes
  `.execute(db);
  await sql`CREATE INDEX artifact_version_session_idx ON artifact_version (created_by_session_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS artifact_version_session_idx`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ADD COLUMN entry_point text,
      ADD COLUMN total_bytes bigint
  `.execute(db);
  await sql`
    UPDATE artifact_version
    SET entry_point = files_metadata->>'entry_point',
        total_bytes = (files_metadata->>'total_bytes')::bigint
  `.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ALTER COLUMN entry_point SET NOT NULL,
      ALTER COLUMN total_bytes SET NOT NULL,
      DROP COLUMN files_metadata,
      DROP COLUMN created_by_agent_id,
      DROP COLUMN created_by_session_id,
      DROP COLUMN created_by_subject
  `.execute(db);
}
