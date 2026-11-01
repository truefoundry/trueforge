import type { SettingsManifest } from '../schemas/settings';

export interface ConfigurationRecord {
  tenant_id: string;
  manifest: SettingsManifest;
  updated_at: string;
}

export interface UpsertConfigurationInput {
  tenant_id: string;
  manifest: SettingsManifest;
}

export interface IConfigurationStore<TTransaction = never> {
  getConfiguration(tenantId: string, transaction?: TTransaction): Promise<ConfigurationRecord | undefined>;
  /** Single-row write: creates the row or replaces the whole manifest. */
  upsertConfiguration(input: UpsertConfigurationInput, transaction?: TTransaction): Promise<ConfigurationRecord>;
}
