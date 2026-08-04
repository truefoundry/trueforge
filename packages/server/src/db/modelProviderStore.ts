/**
 * DB-backed configured model providers: one row per provider per tenant,
 * identity as columns plus a Zod-validated `ModelProviderManifest` jsonb document.
 * Implementations: PostgresModelProviderStore and SqliteModelProviderStore.
 */
import type { ResourceName } from '../schemas/common';
import type { Model, ModelProviderManifest } from '../schemas/modelProvider';

export interface ModelProviderRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: ModelProviderManifest;
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
  name: ResourceName;
  manifest: ModelProviderManifest;
}

export interface IModelProviderStore {
  listProviders(tenantId: string): Promise<ModelProviderRecord[]>;
  getProvider(input: GetProviderInput): Promise<ModelProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest (models included). */
  upsertProvider(input: UpsertProviderInput): Promise<ModelProviderRecord>;
  /** Flattens manifests into the FQN read view for GET /models. */
  listModels(tenantId: string): Promise<Model[]>;
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
