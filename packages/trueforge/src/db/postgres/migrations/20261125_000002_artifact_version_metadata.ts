import { sql, type Kysely } from 'kysely';

/**
 * Fold `entry_point` and `total_bytes` into `artifact_version_metadata` jsonb with a `storage_prefix`.
 * Existing rows get `artifacts/<tenant_id>/<artifact_id>/<version>`; `down` drops `storage_prefix`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact_version ADD COLUMN artifact_version_metadata jsonb`.execute(db);
  await sql`
    UPDATE artifact_version v
    SET artifact_version_metadata = jsonb_build_object(
      'entry_point', v.entry_point,
      'total_bytes', v.total_bytes,
      'storage_prefix', 'artifacts/' || a.tenant_id || '/' || v.artifact_id || '/' || v.version
    )
    FROM artifact a
    WHERE a.id = v.artifact_id
  `.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ALTER COLUMN artifact_version_metadata SET NOT NULL,
      DROP COLUMN entry_point,
      DROP COLUMN total_bytes
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ADD COLUMN entry_point text,
      ADD COLUMN total_bytes bigint
  `.execute(db);
  await sql`
    UPDATE artifact_version
    SET entry_point = artifact_version_metadata->>'entry_point',
        total_bytes = (artifact_version_metadata->>'total_bytes')::bigint
  `.execute(db);
  await sql`
    ALTER TABLE artifact_version
      ALTER COLUMN entry_point SET NOT NULL,
      ALTER COLUMN total_bytes SET NOT NULL,
      DROP COLUMN artifact_version_metadata
  `.execute(db);
}
