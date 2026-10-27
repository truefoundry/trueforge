import { sql, type Kysely } from 'kysely';
import {
  SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX,
  SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ,
  SANDBOX_ENVIRONMENT_VERSION_UQ,
} from '../../indexes';

/**
 * Versioned sandbox environments: parent row + immutable version rows.
 *
 * - Partial unique (tenant_id, name) among lifecycle_stage = 'active' (soft-delete reclaim).
 * - Unique (environment_id, version) on version children.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('sandbox_environment')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('description', 'text', col => col.notNull())
    .addColumn('active_version', 'integer', col => col.notNull())
    .addColumn('lifecycle_stage', 'text', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('sandbox_environment_pkey', ['id'])
    .execute();

  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)}
      ON sandbox_environment (tenant_id, name)
      WHERE lifecycle_stage = 'active'
  `.execute(db);

  await sql`
    CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}
      ON sandbox_environment (tenant_id, (created_by_subject->>'subject_id'))
  `.execute(db);

  await db.schema
    .createTable('sandbox_environment_version')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('environment_id', 'text', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('status_reason', 'text')
    .addColumn('external_ref', 'text', col => col.notNull())
    .addColumn('internal_metadata', 'jsonb', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('sandbox_environment_version_pkey', ['id'])
    .addUniqueConstraint(SANDBOX_ENVIRONMENT_VERSION_UQ, ['environment_id', 'version'])
    .addForeignKeyConstraint(
      'sandbox_environment_version_environment_id_fkey',
      ['environment_id'],
      'sandbox_environment',
      ['id'],
      cb => cb.onDelete('cascade'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('sandbox_environment_version').ifExists().execute();
  await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)}`.execute(db);
  await db.schema.dropTable('sandbox_environment').ifExists().execute();
}
