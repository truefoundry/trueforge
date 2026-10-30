import type { TenantSettingManifest } from '../schemas/tenantSetting';

export interface TenantSettingRecord {
  tenant_id: string;
  manifest: TenantSettingManifest;
}

export interface UpsertTenantSettingInput {
  tenant_id: string;
  manifest: TenantSettingManifest;
}

export interface ITenantSettingStore<TTransaction = never> {
  getTenantSetting(tenantId: string, transaction?: TTransaction): Promise<TenantSettingRecord | undefined>;
  /** Single-row write: creates the row or replaces the whole manifest. */
  upsertTenantSetting(input: UpsertTenantSettingInput, transaction?: TTransaction): Promise<TenantSettingRecord>;
}
