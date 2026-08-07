import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Model } from '../../../schemas/modelProvider';
import {
  flattenProviderModels,
  type GetProviderInput,
  type IModelProviderStore,
  type ModelProviderRecord,
  type UpsertProviderInput,
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

export class PostgresModelProviderStore implements IModelProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listProviders(tenantId: string, transaction?: Transaction<Database>): Promise<ModelProviderRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('model_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getProvider(
    input: GetProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<ModelProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('model_provider')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async upsertProvider(input: UpsertProviderInput, transaction?: Transaction<Database>): Promise<ModelProviderRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('model_provider')
      .values({
        tenant_id: input.tenant_id,
        name: input.manifest.name,
        manifest: json(input.manifest),
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

  async listModels(tenantId: string, transaction?: Transaction<Database>): Promise<Model[]> {
    return flattenProviderModels(await this.listProviders(tenantId, transaction));
  }
}
