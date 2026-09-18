import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX, SANDBOX_ENVIRONMENT_TENANT_NAME_UQ } from '../../indexes';

/**
 * Owned sandbox environments: immutable ULID `id` PK, unique `(tenant_id, name)`,
 * Zod-validated `manifest` jsonb, creator in `created_by_subject`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('sandbox_environment')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('created_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('sandbox_environment_pkey', ['id'])
    .addUniqueConstraint(SANDBOX_ENVIRONMENT_TENANT_NAME_UQ, ['tenant_id', 'name'])
    .execute();

  await sql`
    CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}
      ON sandbox_environment (tenant_id, (created_by_subject->>'subject_id'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(db);
  await db.schema.dropTable('sandbox_environment').ifExists().execute();
}
