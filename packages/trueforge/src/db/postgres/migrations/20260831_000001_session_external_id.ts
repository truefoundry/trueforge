import { sql, type Kysely } from 'kysely';

/**
 * Optional session `external_id`, unique within a tenant when set.
 * NULLs are excluded so sessions without an external id do not collide.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').addColumn('external_id', 'text').execute();
  await sql`
    CREATE UNIQUE INDEX ${sql.raw('session_external_id_uq')}
      ON session (tenant_id, external_id)
      WHERE external_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw('session_external_id_uq')}`.execute(db);
  await db.schema.alterTable('session').dropColumn('external_id').execute();
}
