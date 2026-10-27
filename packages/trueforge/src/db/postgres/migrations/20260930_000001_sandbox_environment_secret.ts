import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ } from '../../indexes';

/** Per-environment Daytona secret refs (Postgres). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('sandbox_environment_secret')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('environment_id', 'text', col => col.notNull())
    .addColumn('secret_name', 'text', col => col.notNull())
    .addColumn('external_secret_name', 'text', col => col.notNull())
    .addColumn('external_secret_id', 'text', col => col.notNull())
    .addColumn('description', 'text', col => col.notNull())
    .addColumn('hash', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('sandbox_environment_secret_pkey', ['id'])
    .addUniqueConstraint(SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ, ['environment_id', 'secret_name'])
    .addForeignKeyConstraint(
      'sandbox_environment_secret_environment_id_fkey',
      ['environment_id'],
      'sandbox_environment',
      ['id'],
      cb => cb.onDelete('cascade'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('sandbox_environment_secret').ifExists().execute();
}
