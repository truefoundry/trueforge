import { type Kysely, sql } from 'kysely';

/**
 * Scope MCP OAuth access/refresh tokens per harness user, and stamp `user_id` on
 * pending authorizations so the public callback can write the correct token row.
 * Drops previously shared (server-only) tokens — callers must re-authorize.
 *
 * SQLite cannot alter primary keys in place, so the token/pending tables are
 * rebuilt (empty after the deletes below). Mirrors
 * db/postgres/migrations/20260813_000001_mcp_oauth_user_scoped.ts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM oauth_token`.execute(db);
  await sql`DROP TABLE oauth_token`.execute(db);
  await sql`
    CREATE TABLE oauth_token (
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      token BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id, user_id)
    ) STRICT
  `.execute(db);

  // In-flight pending rows cannot be attributed to a user; drop them.
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
  await sql`DROP TABLE oauth_pending_authorization`.execute(db);
  await sql`
    CREATE TABLE oauth_pending_authorization (
      id TEXT NOT NULL,
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      auth_data BLOB NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT oauth_pending_authorization_pkey PRIMARY KEY (id)
    ) STRICT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
  await sql`DROP TABLE oauth_pending_authorization`.execute(db);
  await sql`
    CREATE TABLE oauth_pending_authorization (
      id TEXT NOT NULL,
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      auth_data BLOB NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT oauth_pending_authorization_pkey PRIMARY KEY (id)
    ) STRICT
  `.execute(db);

  await sql`DELETE FROM oauth_token`.execute(db);
  await sql`DROP TABLE oauth_token`.execute(db);
  await sql`
    CREATE TABLE oauth_token (
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      token BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id)
    ) STRICT
  `.execute(db);
}
