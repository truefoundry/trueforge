import { sql, type Kysely } from 'kysely';

/** Make the per-thread MCP-auth wait explicit on every persisted checkpoint. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_set(checkpoint, '$.pending_mcp_auth', jsonb('false'))
      WHERE json_type(checkpoint, '$.pending_mcp_auth') IS NULL
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_remove(checkpoint, '$.pending_mcp_auth')
      WHERE json_type(checkpoint, '$.pending_mcp_auth') IS NOT NULL
    `.execute(trx);
  });
}
