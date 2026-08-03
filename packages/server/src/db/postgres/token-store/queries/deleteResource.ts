import type { Kysely } from 'kysely';
import type { Database } from '../../types';

/** Clears the token and any pending authorization for one resource. Client/server registration
 * (`mcp_server.oauth_server` / `.oauth_client`) is owned by the MCP server store, not here. */
export async function deleteResource(db: Kysely<Database>, params: { server_id: string }): Promise<void> {
  await db.transaction().execute(async trx => {
    await trx.deleteFrom('oauth_token').where('oauth_server_id', '=', params.server_id).execute();
    await trx.deleteFrom('oauth_pending_authorization').where('oauth_server_id', '=', params.server_id).execute();
  });
}
