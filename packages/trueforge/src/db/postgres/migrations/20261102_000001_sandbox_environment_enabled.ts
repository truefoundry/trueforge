import { sql, type Kysely } from 'kysely';

/**
 * Per-environment switch gating whether new chats may select the environment.
 * Lives on the parent row, not the version manifest, so flipping it does not
 * append a version and queue a snapshot rebuild.
 *
 * `disabled_at` records the most recent disable; nothing compares it to decide
 * access, it is shown to admins. Existing rows default to enabled.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('sandbox_environment')
    .addColumn('enabled', 'boolean', col => col.notNull().defaultTo(true))
    .addColumn('disabled_at', 'timestamptz')
    .execute();
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('sandbox_environment').dropColumn('disabled_at').dropColumn('enabled').execute();
}
