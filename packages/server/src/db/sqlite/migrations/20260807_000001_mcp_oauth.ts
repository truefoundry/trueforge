import { type Kysely, sql } from 'kysely';

/**
 * MCP Dynamic Client Registration (RFC 7591) tables for SQLite — mirrors
 * db/postgres/migrations/20260803_000001_mcp_oauth.ts, including the `mcp_server.id`
 * FK target (application-generated ulid) for the two child tables.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE mcp_server (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      manifest BLOB NOT NULL,
      oauth_server BLOB,
      oauth_client BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id)
    ) STRICT
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX mcp_server_tenant_name_idx
      ON mcp_server (tenant_id, name)
  `.execute(db);

  await sql`
    CREATE TABLE oauth_token (
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      token BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (oauth_server_id)
    ) STRICT
  `.execute(db);

  await sql`
    CREATE TABLE oauth_pending_authorization (
      id TEXT NOT NULL,
      oauth_server_id TEXT NOT NULL REFERENCES mcp_server (id) ON DELETE CASCADE,
      auth_data BLOB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id)
    ) STRICT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS oauth_pending_authorization`.execute(db);
  await sql`DROP TABLE IF EXISTS oauth_token`.execute(db);
  await sql`DROP TABLE IF EXISTS mcp_server`.execute(db);
}
