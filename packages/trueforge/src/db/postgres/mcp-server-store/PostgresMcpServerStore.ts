import type { Kysely, Selectable, Transaction } from 'kysely';
import type { OAuthClientRecord } from '../../../mcp/auth/types';
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
  type UpsertMcpServerInput,
} from '../../mcpServerStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { Database, McpServerTable } from '../types';

function toRecord(row: Selectable<McpServerTable>): McpServerRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresMcpServerStore implements IMcpServerStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listServers(input: ListMcpServersInput, transaction?: Transaction<Database>): Promise<McpServerRecord[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('mcp_server').selectAll().where('tenant_id', '=', input.tenant_id);
    if (input.names !== undefined) {
      query = query.where('name', 'in', [...input.names]);
    }
    const rows = await query.orderBy('name').execute();
    return rows.map(toRecord);
  }

  async getServer(input: GetMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('mcp_server')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async getServerForUpdate(
    input: GetMcpServerInput,
    transaction: Transaction<Database>,
  ): Promise<McpServerRecord | undefined> {
    const row = await transaction
      .selectFrom('mcp_server')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .forUpdate()
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async createServer(input: CreateMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('mcp_server')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: json(input.manifest),
          oauth_server: null,
          oauth_client: null,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new McpServerNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async upsertServer(input: UpsertMcpServerInput, transaction?: Transaction<Database>): Promise<McpServerRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('mcp_server')
      .values({
        id: newId(),
        tenant_id: input.tenant_id,
        name: input.name,
        manifest: json(input.manifest),
        oauth_server: null,
        oauth_client: null,
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: json(input.manifest),
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async getClient(params: { id: string }, transaction?: Transaction<Database>): Promise<OAuthClientRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('mcp_server')
      .select(['oauth_server', 'oauth_client'])
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
        oauth_server: json(stored.server),
        oauth_client: json(stored.client),
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
