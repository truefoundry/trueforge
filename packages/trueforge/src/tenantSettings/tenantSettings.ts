import type { ITenantSettingStore } from '../db/tenantSettingStore';
import { DEFAULT_TENANT_SETTING_MANIFEST, type TenantSettingManifest } from '../schemas/tenantSetting';

/** Stored switches, or the all-on default when the tenant has no row yet. */
export async function resolveTenantSettingManifest({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: ITenantSettingStore;
}): Promise<TenantSettingManifest> {
  const record = await store.getTenantSetting(tenant_id);
  return record?.manifest ?? DEFAULT_TENANT_SETTING_MANIFEST;
}

/** Whether new chats in this tenant may turn web search on. */
export async function isTenantWebSearchEnabled({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: ITenantSettingStore;
}): Promise<boolean> {
  const manifest = await resolveTenantSettingManifest({ tenant_id, store });
  return manifest.web_search.enabled;
}
