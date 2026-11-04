/**
 * Backend-agnostic behavioural contract for IConfigurationStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { IConfigurationStore } from '../../src/db/configurationStore';
import type { ConfigurationManifest } from '../../src/schemas/configuration';

function manifest({ memory }: { memory: boolean }): ConfigurationManifest {
  return { web_search: { enabled: true }, memory: { enabled: memory } };
}

export function runConfigurationStoreContractSuite(getStore: () => IConfigurationStore): void {
  it('lists only tenants whose stored switch has memory on', async () => {
    const store = getStore();
    await store.upsertConfiguration({ tenant_id: 'on-a', manifest: manifest({ memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'off', manifest: manifest({ memory: false }) });
    await store.upsertConfiguration({ tenant_id: 'on-b', manifest: manifest({ memory: true }) });

    expect((await store.listMemoryEnabledTenantIds()).sort()).toEqual(['on-a', 'on-b']);
  });

  it('drops a tenant once its switch is turned off', async () => {
    const store = getStore();
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ memory: false }) });

    expect(await store.listMemoryEnabledTenantIds()).toEqual([]);
  });
}
