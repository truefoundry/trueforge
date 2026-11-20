import { sql, type Kysely } from 'kysely';

/**
 * Tenant-wide feature switches (canonical DDL owner).
 *
 * Singleton per tenant: PK is `tenant_id` only. The manifest is one jsonb
 * document validated by Zod on every write. A tenant with no row keeps every
 * switch on until the row is written on first read or update.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('configuration')
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('configuration_pkey', ['tenant_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('configuration').ifExists().cascade().execute();
}
