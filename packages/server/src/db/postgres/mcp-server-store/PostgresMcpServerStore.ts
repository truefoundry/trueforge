import type { Kysely, Selectable } from 'kysely';
import { ulid } from 'ulid';
import type { ResourceName } from '../../../schemas/common';
import type { McpServerManifest } from '../../../schemas/mcpServer';
import type { IMcpServerStore, McpServerRecord } from '../../mcpServerStore';
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

  async getServer(tenantId: string, name: string): Promise<McpServerRecord | undefined> {
    const row = await this.#db
      .selectFrom('mcp_server')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async upsertServer(tenantId: string, name: ResourceName, manifest: McpServerManifest): Promise<McpServerRecord> {
    const row = await this.#db
      .insertInto('mcp_server')
      .values({
        id: ulid(),
        tenant_id: tenantId,
        name,
        manifest: json(manifest),
        oauth_server: null,
        oauth_client: null,
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: json(manifest),
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }
}
