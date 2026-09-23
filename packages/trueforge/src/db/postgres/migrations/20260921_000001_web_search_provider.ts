import { sql, type Kysely } from 'kysely';

/**
 * Configured web-search provider (canonical DDL owner).
 *
 * Singleton per tenant: PK is `tenant_id` only. Manifest (type, auth) is one
 * jsonb document validated by Zod on every write.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('web_search_provider')
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('web_search_provider_pkey', ['tenant_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('web_search_provider').ifExists().cascade().execute();
}
