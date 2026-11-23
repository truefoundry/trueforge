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

  await sql`
    CREATE INDEX artifact_list_idx
      ON artifact (tenant_id, (created_by_subject->>'subject_id'), updated_at DESC, id)
  `.execute(db);
  await sql`CREATE INDEX artifact_session_idx ON artifact (tenant_id, created_by_session_id)`.execute(db);
  await db.schema
    .createTable('artifact_version')
    .addColumn('artifact_id', 'text', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('entry_point', 'text', col => col.notNull())
    .addColumn('storage_prefix', 'text', col => col.notNull())
    .addColumn('total_bytes', 'bigint', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('artifact_version_pkey', ['artifact_id', 'version'])
    .addForeignKeyConstraint('artifact_version_artifact_id_fkey', ['artifact_id'], 'artifact', ['id'], fk =>
      fk.onDelete('cascade'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('artifact_version').ifExists().execute();
  await db.schema.dropTable('artifact').ifExists().execute();
}
