import { type Kysely, sql } from 'kysely';

/**
 * Pending-authorization `auth_data` jsonb key `redirect_url` → `return_to` (path).
 * In-flight rows are short-lived and cannot be rewritten safely; drop them so
 * callers restart authorize with the new shape.
 * Mirrors db/postgres/migrations/20260818_000001_mcp_pending_auth_return_to.ts.
 *
 * Wrapped in a transaction. SQLite has no LOCK TABLE; a no-op UPDATE escalates
 * the deferred txn to a RESERVED write lock before the delete.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`UPDATE oauth_pending_authorization SET created_at = created_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_pending_authorization`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    // Rows written with `return_to` are incompatible with the prior shape; clear them.
    await sql`UPDATE oauth_pending_authorization SET created_at = created_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_pending_authorization`.execute(trx);
  });
}
