import type { Kysely, Selectable } from 'kysely';
import type { ResourceName } from '../../../schemas/common';
import type { ProviderManifest } from '../../../schemas/modelProvider';
import {
  flattenProviderModels,
  type IModelProviderStore,
  type ModelProviderRecord,
  type ModelReadEntry,
} from '../../modelProviderStore';
import { json, now } from '../sqlExpressions';
import type { Database, ModelProviderTable } from '../types';

function toRecord(row: Selectable<ModelProviderTable>): ModelProviderRecord {
  return {
    tenant_id: row.tenant_id,
    name: row.name,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresModelProviderStore implements IModelProviderStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listProviders(tenantId: string): Promise<ModelProviderRecord[]> {
    const rows = await this.#db
      .selectFrom('model_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getProvider(tenantId: string, providerName: string): Promise<ModelProviderRecord | undefined> {
    const row = await this.#db
      .selectFrom('model_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('name', '=', providerName)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async upsertProvider(
    tenantId: string,
    providerName: ResourceName,
    manifest: ProviderManifest,
  ): Promise<ModelProviderRecord> {
    const row = await this.#db
      .insertInto('model_provider')
      .values({
        tenant_id: tenantId,
        name: providerName,
        manifest: json(manifest),
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

  async listModels(tenantId: string): Promise<ModelReadEntry[]> {
    return flattenProviderModels(await this.listProviders(tenantId));
  }
}
