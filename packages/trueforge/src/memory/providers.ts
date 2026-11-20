import type { Logger } from 'winston';
import { isMemoryEnabledForTenant, type IConfigurationStore } from '../db/configurationStore';
import type { IMemoryProviderStore } from '../db/memoryProviderStore';
import type { MemoryProviderManifest } from '../schemas/memoryProvider';
import { createMemoryProvider } from './createMemoryProvider';
import type { MemoryProvider } from './MemoryProvider';

/** Whether the tenant has a memory provider: saved in settings, or supplied by the platform. */
export async function hasConfiguredMemoryProvider({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IMemoryProviderStore;
}): Promise<boolean> {
  const record = await store.getProvider(tenant_id);
  return record !== undefined;
}

/** One provider per manifest, reused so a provider's caches (e.g. Zep user ids) outlive a single turn. */
export class MemoryProviderCache {
  readonly #logger: Logger;
  readonly #providers = new Map<string, MemoryProvider>();

  constructor({ logger }: { logger: Logger }) {
    this.#logger = logger;
  }

  get(manifest: MemoryProviderManifest): MemoryProvider {
    const key = JSON.stringify(manifest);
    const cached = this.#providers.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const provider = createMemoryProvider({ manifest, logger: this.#logger });
    this.#providers.set(key, provider);
    return provider;
  }
}

export interface TenantMemoryDeps {
  memoryProviderStore: IMemoryProviderStore;
  configurationStore: IConfigurationStore;
  providers: Pick<MemoryProviderCache, 'get'>;
}

/** The tenant's memory provider, or undefined unless it has one and its memory switch is on. */
export async function resolveTenantMemoryProvider({
  tenant_id,
  memoryProviderStore,
  configurationStore,
  providers,
}: TenantMemoryDeps & { tenant_id: string }): Promise<MemoryProvider | undefined> {
  const [record, enabled] = await Promise.all([
    memoryProviderStore.getProvider(tenant_id),
    isMemoryEnabledForTenant({ tenant_id, store: configurationStore }),
  ]);
  return record === undefined || !enabled ? undefined : providers.get(record.manifest);
}

/** Every tenant with its memory switch on and a provider, mapped to that provider. */
export async function listTenantMemoryProviders({
  memoryProviderStore,
  configurationStore,
  providers,
}: TenantMemoryDeps): Promise<Map<string, MemoryProvider>> {
  const tenantIds = await configurationStore.listTenantIdsWithFeatureEnabled('memory');
  const records = await Promise.all(tenantIds.map(tenantId => memoryProviderStore.getProvider(tenantId)));
  const byTenant = new Map<string, MemoryProvider>();
  for (const record of records) {
    if (record !== undefined) {
      byTenant.set(record.tenant_id, providers.get(record.manifest));
    }
  }
  return byTenant;
}
