import { sql, type Kysely } from 'kysely';

/**
 * Required `description` on `mcp_server.manifest`. Backfill `{name} MCP Server`
 * when the key is missing or blank so existing rows satisfy McpServerManifestSchema.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE mcp_server
    SET manifest = manifest || jsonb_build_object('description', name || ' MCP Server')
    WHERE btrim(coalesce(manifest->>'description', '')) = ''
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE mcp_server
    SET manifest = manifest - 'description'
    WHERE manifest->>'description' = name || ' MCP Server'
  `.execute(db);
}
