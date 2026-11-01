import type { ConfigurationsManifest } from '../schemas/configurations';

export interface ConfigurationRecord {
  tenant_id: string;
  manifest: ConfigurationsManifest;
  updated_at: string;
}

export interface UpsertConfigurationInput {
  tenant_id: string;
  manifest: ConfigurationsManifest;
}

export interface GetOrCreateConfigurationInput {
  tenant_id: string;
  /** Stored only when the tenant has no row yet. */
  default_manifest: ConfigurationsManifest;
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
