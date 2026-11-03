import { DEFAULT_CONFIGURATION_MANIFEST, type ConfigurationManifest } from '../schemas/configuration';

export interface ConfigurationRecord {
  tenant_id: string;
  manifest: ConfigurationManifest;
  updated_at: string;
}

export interface UpsertConfigurationInput {
  tenant_id: string;
  manifest: ConfigurationManifest;
}

export interface GetOrCreateConfigurationInput {
  tenant_id: string;
  /** Stored only when the tenant has no row yet. */
  default_manifest: ConfigurationManifest;
}

export interface IConfigurationStore<TTransaction = never> {
  getConfiguration(tenantId: string, transaction?: TTransaction): Promise<ConfigurationRecord | undefined>;
  /** Single-row write: creates the row or replaces the whole manifest. */
  upsertConfiguration(input: UpsertConfigurationInput, transaction?: TTransaction): Promise<ConfigurationRecord>;
  /**
   * Returns the stored row, inserting the defaults only when none exists.
   * A row written concurrently is returned untouched, so a read can never
   * roll a tenant back to the defaults.
   */
  getOrCreateConfiguration(
    input: GetOrCreateConfigurationInput,
    transaction?: TTransaction,
  ): Promise<ConfigurationRecord>;
}

/** Whether the tenant switch lets web search be turned on. Reads only; never writes the row. */
export async function isWebSearchEnabledForTenant({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<boolean> {
  const record = await store.getConfiguration(tenant_id);
  const manifest = record?.manifest ?? DEFAULT_CONFIGURATION_MANIFEST;
  return manifest.web_search.enabled;
}
