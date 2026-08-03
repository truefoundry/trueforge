import type { ExpressionBuilder, Kysely } from 'kysely';
import type { ResourceName } from '../../../schemas/common';
import type { Model, ProviderManifest } from '../../../schemas/modelProvider';
import { flattenProviderModels, type IModelProviderStore, type ModelProviderRecord } from '../../modelProviderStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'model_provider'>) {
  return [
    'tenant_id' as const,
    'name' as const,
    jsonText<ProviderManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteModelProviderStore implements IModelProviderStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listProviders(tenantId: string): Promise<ModelProviderRecord[]> {
    return await this.#db
      .selectFrom('model_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
  }

  async getProvider(tenantId: string, providerName: string): Promise<ModelProviderRecord | undefined> {
    return await this.#db
      .selectFrom('model_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .where('name', '=', providerName)
      .executeTakeFirst();
  }

  async upsertProvider(
    tenantId: string,
    providerName: ResourceName,
    manifest: ProviderManifest,
  ): Promise<ModelProviderRecord> {
    const timestamp = nowIso();
    return await this.#db
      .insertInto('model_provider')
      .values({
        tenant_id: tenantId,
        name: providerName,
        manifest: jsonbBind(manifest),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: jsonbBind(manifest),
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }

  async listModels(tenantId: string): Promise<Model[]> {
    return flattenProviderModels(await this.listProviders(tenantId));
  }
}
