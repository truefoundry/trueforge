/**
 * DB-backed configured model providers: one row per provider per tenant,
 * identity as columns plus the Zod-validated `ModelProvider` document as jsonb.
 * Implementations: PostgresModelProviderStore and SqliteModelProviderStore.
 */
import type { ResourceName } from '../schemas/common';
import type { Model, ModelProvider } from '../schemas/modelProvider';

export interface ModelProviderRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: ModelProvider;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface GetProviderInput {
  tenant_id: string;
  name: string;
}

export interface UpsertProviderInput {
  tenant_id: string;
  /** Derived from the document by `modelProviderName`, never chosen by the caller. */
  name: ResourceName;
  manifest: ModelProvider;
}

export interface IModelProviderStore<TTransaction = never> {
  listProviders(tenantId: string, transaction?: TTransaction): Promise<ModelProviderRecord[]>;
  getProvider(input: GetProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest (models included). */
  upsertProvider(input: UpsertProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord>;
  /** Flattens manifests into the FQN read view for GET /models. */
  listModels(tenantId: string, transaction?: TTransaction): Promise<Model[]>;
}

/** Application-side flatten shared by both store implementations. */
export function flattenProviderModels(records: ModelProviderRecord[]): Model[] {
  return records.flatMap(record =>
    record.manifest.models.map(model => ({
      name: `${record.name}/${model.name}`,
      model_id: model.model_id,
      properties: model.properties,
    })),
  );
}
