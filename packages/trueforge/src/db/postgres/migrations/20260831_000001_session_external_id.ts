import { sql, type Kysely } from 'kysely';
import { SESSION_EXTERNAL_ID_UQ } from '../../indexes';

/**
 * Optional session `external_id`, unique within a tenant when set.
 * NULLs are excluded so sessions without an external id do not collide.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').addColumn('external_id', 'text').execute();
  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SESSION_EXTERNAL_ID_UQ)}
      ON session (tenant_id, external_id)
      WHERE external_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_EXTERNAL_ID_UQ)}`.execute(db);
  await db.schema.alterTable('session').dropColumn('external_id').execute();
}
