import { sql, type Kysely } from 'kysely';

/** Artifact metadata; file bytes live in object storage. No FK to session: artifacts outlive it. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('artifact')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('latest_version', 'integer', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_by_session_id', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_pkey', ['id'])
    .addUniqueConstraint('artifact_tenant_slug_uq', ['tenant_id', 'slug'])
    .execute();

  await sql`CREATE INDEX artifact_list_idx ON artifact (tenant_id, updated_at DESC, id)`.execute(db);
  await sql`CREATE INDEX artifact_session_idx ON artifact (tenant_id, created_by_session_id)`.execute(db);

  await db.schema
    .createTable('artifact_version')
    .addColumn('artifact_id', 'text', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('entrypoint', 'text', col => col.notNull())
    .addColumn('created_by_turn_id', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_version_pkey', ['artifact_id', 'version'])
    .addForeignKeyConstraint('artifact_version_artifact_id_fkey', ['artifact_id'], 'artifact', ['id'], fk =>
      fk.onDelete('cascade'),
    )
    .execute();

  await sql`CREATE INDEX artifact_version_status_idx ON artifact_version (artifact_id, status)`.execute(db);

  await db.schema
    .createTable('artifact_file')
    .addColumn('artifact_id', 'text', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('path', 'text', col => col.notNull())
    .addColumn('size_bytes', 'bigint', col => col.notNull())
    .addColumn('storage_key', 'text', col => col.notNull())
    .addColumn('sha256', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_file_pkey', ['artifact_id', 'version', 'path'])
    .addForeignKeyConstraint(
      'artifact_file_version_fkey',
      ['artifact_id', 'version'],
      'artifact_version',
      ['artifact_id', 'version'],
      fk => fk.onDelete('cascade'),
    )
    .execute();
}
