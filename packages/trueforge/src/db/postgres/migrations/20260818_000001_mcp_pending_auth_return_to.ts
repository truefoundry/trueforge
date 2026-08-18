import { sql, type Kysely } from 'kysely';

/**
 * Pending-authorization `auth_data` jsonb key `redirect_url` → `return_to` (path).
 * In-flight rows are short-lived and cannot be rewritten safely; drop them so
 * callers restart authorize with the new shape.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`LOCK TABLE oauth_pending_authorization IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  // Rows written with `return_to` are incompatible with the prior shape; clear them.
  await sql`LOCK TABLE oauth_pending_authorization IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
}
