import type { IConfigurationStore } from '../db/configurationStore';
import { DEFAULT_SETTINGS_MANIFEST, type SettingsManifest } from '../schemas/settings';

/** Stored switches, or the all-on default when the tenant has no row yet. Does not write. */
export async function resolveSettingsManifest({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<SettingsManifest> {
  const record = await store.getConfiguration(tenant_id);
  return record?.manifest ?? DEFAULT_SETTINGS_MANIFEST;
}

/** Whether new chats in this tenant may turn web search on. */
export async function isWebSearchEnabledForTenant({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<boolean> {
  const manifest = await resolveSettingsManifest({ tenant_id, store });
  return manifest.web_search.enabled;
}
