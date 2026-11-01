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

export interface IConfigurationStore<TTransaction = never> {
  getConfiguration(tenantId: string, transaction?: TTransaction): Promise<ConfigurationRecord | undefined>;
  /** Single-row write: creates the row or replaces the whole manifest. */
  upsertConfiguration(input: UpsertConfigurationInput, transaction?: TTransaction): Promise<ConfigurationRecord>;
}
