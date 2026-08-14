import { type Kysely, sql } from 'kysely';

/**
 * Required `description` on `mcp_server.manifest`. Backfill `{name} MCP Server`
 * when the key is missing or blank so existing rows satisfy McpServerManifestSchema.
 * Mirrors db/postgres/migrations/20260815_000002_mcp_server_description.ts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE mcp_server
    SET manifest = jsonb_set(manifest, '$.description', jsonb(json_quote(name || ' MCP Server')))
    WHERE trim(coalesce(json_extract(manifest, '$.description'), '')) = ''
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE mcp_server
    SET manifest = jsonb_remove(manifest, '$.description')
    WHERE json_extract(manifest, '$.description') = name || ' MCP Server'
  `.execute(db);
}
