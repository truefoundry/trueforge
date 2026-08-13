import { type Kysely, sql } from 'kysely';

/**
 * Scope MCP OAuth access/refresh tokens per harness user, and stamp `user_id` on
 * pending authorizations so the public callback can write the correct token row.
 * Drops previously shared (server-only) tokens — callers must re-authorize.
 *
 * SQLite cannot alter primary keys in place, so the token/pending tables are
 * rebuilt (empty after the deletes below). Mirrors
 * db/postgres/migrations/20260813_000001_mcp_oauth_user_scoped.ts.
 *
 * Wrapped in a transaction so drop/create pairs roll back together. SQLite has
 * no LOCK TABLE / ACCESS EXCLUSIVE; a no-op UPDATE before each delete escalates
 * the deferred txn to a RESERVED write lock so concurrent connections cannot
 * insert until this migration commits.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    // Escalate deferred txn → RESERVED (writer lock) before clearing the table.
    await sql`UPDATE oauth_token SET updated_at = updated_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_token`.execute(trx);
    await sql`DROP TABLE oauth_token`.execute(trx);
    await sql`
      CREATE TABLE oauth_token (
        oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        token BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id, user_id)
      ) STRICT
    `.execute(trx);

    // In-flight pending rows cannot be attributed to a user; drop them.
    await sql`UPDATE oauth_pending_authorization SET created_at = created_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_pending_authorization`.execute(trx);
    await sql`DROP TABLE oauth_pending_authorization`.execute(trx);
    await sql`
      CREATE TABLE oauth_pending_authorization (
        id TEXT NOT NULL,
        oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        auth_data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        CONSTRAINT oauth_pending_authorization_pkey PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`UPDATE oauth_pending_authorization SET created_at = created_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_pending_authorization`.execute(trx);
    await sql`DROP TABLE oauth_pending_authorization`.execute(trx);
    await sql`
      CREATE TABLE oauth_pending_authorization (
        id TEXT NOT NULL,
        oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
        auth_data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        CONSTRAINT oauth_pending_authorization_pkey PRIMARY KEY (id)
      ) STRICT
    `.execute(trx);

    await sql`UPDATE oauth_token SET updated_at = updated_at WHERE false`.execute(trx);
    await sql`DELETE FROM oauth_token`.execute(trx);
    await sql`DROP TABLE oauth_token`.execute(trx);
    await sql`
      CREATE TABLE oauth_token (
        oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
        token BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id)
      ) STRICT
    `.execute(trx);
  });
}
