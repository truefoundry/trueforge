/**
 * Backend-agnostic behavioural contract for IConfigurationStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { IConfigurationStore } from '../../src/db/configurationStore';
import type { ConfigurationManifest } from '../../src/schemas/configuration';

function manifest({ webSearch, memory }: { webSearch: boolean; memory: boolean }): ConfigurationManifest {
  return { web_search: { enabled: webSearch }, memory: { enabled: memory } };
}

export function runConfigurationStoreContractSuite(getStore: () => IConfigurationStore): void {
  it('lists only tenants whose stored row has the given feature on', async () => {
    const store = getStore();
    await store.upsertConfiguration({ tenant_id: 'both', manifest: manifest({ webSearch: true, memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'search', manifest: manifest({ webSearch: true, memory: false }) });
    await store.upsertConfiguration({ tenant_id: 'memory', manifest: manifest({ webSearch: false, memory: true }) });

    expect((await store.listTenantIdsWithFeatureEnabled('memory')).sort()).toEqual(['both', 'memory']);
    expect((await store.listTenantIdsWithFeatureEnabled('web_search')).sort()).toEqual(['both', 'search']);
  });

  it('drops a tenant once its switch is turned off', async () => {
    const store = getStore();
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ webSearch: true, memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ webSearch: true, memory: false }) });

    expect(await store.listTenantIdsWithFeatureEnabled('memory')).toEqual([]);
  });
}
