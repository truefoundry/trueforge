/**
 * DB-backed configured model providers: one row per provider per tenant,
 * identity as columns plus a Zod-validated `ProviderManifest` jsonb document.
 * Implementations: PostgresModelProviderStore and SqliteModelProviderStore.
 */
import type { ResourceName } from '../schemas/common';
import type { ModelProperties, ProviderManifest } from '../schemas/modelProvider';

export interface ModelProviderRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: ProviderManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

/** Read view for GET /models: the fully qualified name resolves the provider. */
export interface ModelReadEntry {
  /** `${provider.name}/${model.name}`, e.g. "openai/gpt-5-6-sol". */
  name: string;
  model_id: string;
  properties: ModelProperties;
}

export interface IModelProviderStore {
  listProviders(tenantId: string): Promise<ModelProviderRecord[]>;
  getProvider(tenantId: string, providerName: string): Promise<ModelProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest (models included). */
  upsertProvider(
    tenantId: string,
    providerName: ResourceName,
    manifest: ProviderManifest,
  ): Promise<ModelProviderRecord>;
  /** Flattens manifests into the FQN read view for GET /models. */
  listModels(tenantId: string): Promise<ModelReadEntry[]>;
}

/** Application-side flatten shared by both store implementations. */
export function flattenProviderModels(records: ModelProviderRecord[]): ModelReadEntry[] {
  return records.flatMap(record =>
    record.manifest.models.map(model => ({
      name: `${record.name}/${model.name}`,
      model_id: model.model_id,
      properties: model.properties,
    })),
  );
}
