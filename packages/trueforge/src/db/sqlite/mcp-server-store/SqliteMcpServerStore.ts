import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { OAuthClientRecord } from '../../../mcp/auth/types';
import type { McpServerManifest } from '../../../schemas/mcpServer';
import { newId } from '../../../utils/id';
import {
  fromStoredOAuthClientRecord,
  McpServerNameConflictError,
  toStoredOAuthClientRecord,
  type CreateMcpServerInput,
  type GetMcpServerInput,
  type IMcpServerStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type OAuthClient,
  type OAuthServer,
  type UpsertMcpServerInput,
} from '../../mcpServerStore';
import { isUniqueViolation } from '../client';
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

export class SqliteMcpServerStore implements IMcpServerStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listServers(input: ListMcpServersInput, transaction?: Transaction<Database>): Promise<McpServerRecord[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('mcp_server').select(recordColumns).where('tenant_id', '=', input.tenant_id);
    if (input.names !== undefined) {
      query = query.where('name', 'in', [...input.names]);
    }
    return await query.orderBy('name').execute();
  }

  async getServer(input: GetMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('mcp_server')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  /**
   * SQLite has no row-level FOR UPDATE; the required write transaction (BEGIN IMMEDIATE)
   * serializes concurrent writers so RMW of header secrets stays consistent.
   */
  async getServerForUpdate(
    input: GetMcpServerInput,
    transaction: Transaction<Database>,
  ): Promise<McpServerRecord | undefined> {
    return await transaction
      .selectFrom('mcp_server')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  async createServer(input: CreateMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    try {
      return await db
        .insertInto('mcp_server')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: jsonbBind(input.manifest),
          oauth_server: null,
          oauth_client: null,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(recordColumns)
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new McpServerNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async upsertServer(input: UpsertMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('mcp_server')
      .values({
        id: newId(),
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

  async getClient(params: { id: string }, transaction?: Transaction<Database>): Promise<OAuthClientRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
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

  async saveClient(
    params: { id: string; record: OAuthClientRecord },
    transaction?: Transaction<Database>,
  ): Promise<void> {
    const db = transaction ?? this.#db;
    const stored = toStoredOAuthClientRecord(params.record);
    await db
      .updateTable('mcp_server')
      .set({
        oauth_server: jsonbBind(stored.server),
        oauth_client: jsonbBind(stored.client),
      })
      .where('id', '=', params.id)
      .execute();
  }

  async deleteClient(params: { id: string }, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db
      .updateTable('mcp_server')
      .set({
        oauth_server: null,
        oauth_client: null,
      })
      .where('id', '=', params.id)
      .execute();
  }
}
