import { sql, type Kysely } from 'kysely';

/**
 * Tenant-wide feature switches (canonical DDL owner).
 *
 * Singleton per tenant: PK is `tenant_id` only. The manifest is one jsonb
 * document validated by Zod on every write. A tenant with no row keeps every
 * switch on.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('tenant_setting')
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addPrimaryKeyConstraint('tenant_setting_pkey', ['tenant_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('tenant_setting').ifExists().cascade().execute();
}
