import type { OAuthClientRecord } from '@truefoundry/utils-core/core';
import type { ExpressionBuilder, Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { McpServerManifest } from '../../../schemas/mcpServer';
import type { OAuthClient, OAuthServer } from '../../mcpOAuthTypes';
import { fromStoredOAuthClientRecord, toStoredOAuthClientRecord } from '../../mcpOAuthTypes';
import type { GetMcpServerInput, IMcpServerStore, McpServerRecord, UpsertMcpServerInput } from '../../mcpServerStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'mcp_server'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'name' as const,
    jsonText<McpServerManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteMcpServerStore implements IMcpServerStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listServers(tenantId: string): Promise<McpServerRecord[]> {
    return await this.#db
      .selectFrom('mcp_server')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
  }

  async getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined> {
    return await this.#db
      .selectFrom('mcp_server')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  async upsertServer(input: UpsertMcpServerInput): Promise<McpServerRecord> {
    const timestamp = nowIso();
    return await this.#db
      .insertInto('mcp_server')
      .values({
        id: ulid(),
        tenant_id: input.tenant_id,
        name: input.name,
        manifest: jsonbBind(input.manifest),
        oauth_server: null,
        oauth_client: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: jsonbBind(input.manifest),
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }

  async getClient(params: { id: string }): Promise<OAuthClientRecord | undefined> {
    const row = await this.#db
      .selectFrom('mcp_server')
      .select(eb => [
        jsonText<OAuthServer | null>(eb.ref('oauth_server')).as('oauth_server'),
        jsonText<OAuthClient | null>(eb.ref('oauth_client')).as('oauth_client'),
      ])
      .where('id', '=', params.id)
      .executeTakeFirst();
    if (row?.oauth_server == null || row.oauth_client == null) {
      return undefined;
    }
    return fromStoredOAuthClientRecord({ server: row.oauth_server, client: row.oauth_client });
  }

  async saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void> {
    const stored = toStoredOAuthClientRecord(params.record);
    await this.#db
      .updateTable('mcp_server')
      .set({
        oauth_server: jsonbBind(stored.server),
        oauth_client: jsonbBind(stored.client),
      })
      .where('id', '=', params.id)
      .execute();
  }

  async deleteClient(params: { id: string }): Promise<void> {
    await this.#db
      .updateTable('mcp_server')
      .set({
        oauth_server: null,
        oauth_client: null,
      })
      .where('id', '=', params.id)
      .execute();
  }
}
