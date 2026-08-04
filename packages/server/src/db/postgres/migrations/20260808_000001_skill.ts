import { sql, type Kysely } from 'kysely';

/**
 * Configured skills (canonical DDL owner).
 *
 * Manifest pattern: identity as columns, everything else (type, url, path, ref,
 * description — and duplicated `name`) in one `manifest` jsonb validated by Zod
 * on every write. The PK is the only DB-level invariant — all others live at
 * the Zod layer — so future manifest fields are schema changes, not migrations.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('skill')
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('skill_pkey', ['tenant_id', 'name'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('skill').ifExists().cascade().execute();
}
