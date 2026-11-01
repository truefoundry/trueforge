import type { IConfigurationStore } from '../db/configurationStore';
import { DEFAULT_CONFIGURATIONS_MANIFEST, type ConfigurationsManifest } from '../schemas/configurations';

/** Stored switches, or the all-on default when the tenant has no row yet. Does not write. */
export async function resolveConfigurationsManifest({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<ConfigurationsManifest> {
  const record = await store.getConfiguration(tenant_id);
  return record?.manifest ?? DEFAULT_CONFIGURATIONS_MANIFEST;
}

/** Whether new chats in this tenant may turn web search on. */
export async function isWebSearchEnabledForTenant({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<boolean> {
  const manifest = await resolveConfigurationsManifest({ tenant_id, store });
  return manifest.web_search.enabled;
}
