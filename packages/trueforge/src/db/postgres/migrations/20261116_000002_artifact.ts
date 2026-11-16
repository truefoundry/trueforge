import { sql, type Kysely } from 'kysely';

/**
 * Published artifacts: one row per shareable link, one immutable version per publish,
 * and one row per file in that version. Versions keep their own storage prefix so a
 * backend change does not hide older versions. `session_id` is not a foreign key:
 * the artifact outlives the session that produced it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('artifact')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('latest_version', 'integer', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_pkey', ['id'])
    .execute();

  await db.schema.createIndex('artifact_slug_uq').on('artifact').columns(['tenant_id', 'slug']).unique().execute();
  await sql`
    CREATE INDEX artifact_list_idx ON artifact (tenant_id, updated_at DESC, id DESC)
  `.execute(db);

  await db.schema
    .createTable('artifact_version')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('artifact_id', 'text', col => col.notNull().references('artifact.id').onDelete('cascade'))
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('entry_path', 'text', col => col.notNull())
    .addColumn('entry_content_type', 'text', col => col.notNull())
    .addColumn('file_count', 'integer', col => col.notNull())
    .addColumn('total_size_bytes', 'integer', col => col.notNull())
    .addColumn('manifest_sha256', 'text', col => col.notNull())
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('turn_id', 'text', col => col.notNull())
    .addColumn('source_root', 'text', col => col.notNull())
    .addColumn('note', 'text')
    .addColumn('storage_backend', 'text', col => col.notNull())
    .addColumn('storage_location', 'text', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_version_pkey', ['id'])
    .addCheckConstraint('artifact_version_entry_type_chk', sql`entry_content_type in ('html', 'markdown')`)
    .addCheckConstraint('artifact_version_storage_backend_chk', sql`storage_backend in ('local', 's3')`)
    .execute();

  await db.schema
    .createIndex('artifact_version_number_uq')
    .on('artifact_version')
    .columns(['artifact_id', 'version'])
    .unique()
    .execute();
  await db.schema
    .createIndex('artifact_version_session_idx')
    .on('artifact_version')
    .columns(['tenant_id', 'session_id'])
    .execute();

  await db.schema
    .createTable('artifact_file')
    .addColumn('artifact_version_id', 'text', col =>
      col.notNull().references('artifact_version.id').onDelete('cascade'),
    )
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('path', 'text', col => col.notNull())
    .addColumn('size_bytes', 'integer', col => col.notNull())
    .addColumn('sha256', 'text', col => col.notNull())
    .addColumn('media_type', 'text', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_file_pkey', ['artifact_version_id', 'path'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('artifact_file').ifExists().cascade().execute();
  await db.schema.dropTable('artifact_version').ifExists().cascade().execute();
  await db.schema.dropTable('artifact').ifExists().cascade().execute();
}
