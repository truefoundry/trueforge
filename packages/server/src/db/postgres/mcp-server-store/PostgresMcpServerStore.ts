import type { Kysely, Selectable } from 'kysely';
import { ulid } from 'ulid';
import type { GetMcpServerInput, IMcpServerStore, McpServerRecord, UpsertMcpServerInput } from '../../mcpServerStore';
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

export class PostgresMcpServerStore implements IMcpServerStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listServers(tenantId: string): Promise<McpServerRecord[]> {
    const rows = await this.#db
      .selectFrom('mcp_server')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined> {
    const row = await this.#db
      .selectFrom('mcp_server')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async upsertServer(input: UpsertMcpServerInput): Promise<McpServerRecord> {
    const row = await this.#db
      .insertInto('mcp_server')
      .values({
        id: ulid(),
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
}
