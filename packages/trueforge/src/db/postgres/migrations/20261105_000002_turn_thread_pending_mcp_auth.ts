import { sql, type Kysely } from 'kysely';

/** Make the per-thread MCP-auth wait explicit on every persisted checkpoint. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = jsonb_set(checkpoint, '{pending_mcp_auth}', 'false'::jsonb, true)
    WHERE NOT checkpoint ? 'pending_mcp_auth'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = checkpoint - 'pending_mcp_auth'
    WHERE checkpoint ? 'pending_mcp_auth'
  `.execute(db);
}
