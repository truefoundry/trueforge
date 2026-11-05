/**
 * Backend-agnostic behavioural contract for IConfigurationStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { isMemoryEnabledForTenant, type IConfigurationStore } from '../../src/db/configurationStore';
import type { ConfigurationManifest } from '../../src/schemas/configuration';

export interface ConfigurationStoreContractEnv {
  store: IConfigurationStore;
  /** Writes a manifest as raw JSON, the way a server on an older version stores it. */
  insertRawManifest: (input: { tenant_id: string; manifest_json: string }) => Promise<void>;
  /** The stored manifest as parsed JSON, read without going through the store. */
  readRawManifest: (tenant_id: string) => Promise<unknown>;
}

function manifest({ webSearch, memory }: { webSearch: boolean; memory: boolean }): ConfigurationManifest {
  return { web_search: { enabled: webSearch }, memory: { enabled: memory } };
}

const LEGACY_MANIFEST_JSON = '{"web_search":{"enabled":false}}';
const SEEDED = { web_search: { enabled: false }, memory: { enabled: false } };

export function runConfigurationStoreContractSuite(getEnv: () => ConfigurationStoreContractEnv): void {
  it('lists only tenants whose stored row has the given feature on', async () => {
    const { store } = getEnv();
    await store.upsertConfiguration({ tenant_id: 'both', manifest: manifest({ webSearch: true, memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'search', manifest: manifest({ webSearch: true, memory: false }) });
    await store.upsertConfiguration({ tenant_id: 'memory', manifest: manifest({ webSearch: false, memory: true }) });

    expect((await store.listTenantIdsWithFeatureEnabled('memory')).sort()).toEqual(['both', 'memory']);
    expect((await store.listTenantIdsWithFeatureEnabled('web_search')).sort()).toEqual(['both', 'search']);
  });

  it('drops a tenant once its switch is turned off', async () => {
    const { store } = getEnv();
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ webSearch: true, memory: true }) });
    await store.upsertConfiguration({ tenant_id: 'acme', manifest: manifest({ webSearch: true, memory: false }) });

    expect(await store.listTenantIdsWithFeatureEnabled('memory')).toEqual([]);
  });

  it('getConfiguration seeds a missing switch with its default into the stored row', async () => {
    const { store, insertRawManifest, readRawManifest } = getEnv();
    await insertRawManifest({ tenant_id: 'legacy', manifest_json: LEGACY_MANIFEST_JSON });

    expect((await store.getConfiguration('legacy'))?.manifest).toEqual(SEEDED);
    expect(await readRawManifest('legacy')).toEqual(SEEDED);
    await expect(isMemoryEnabledForTenant({ tenant_id: 'legacy', store })).resolves.toBe(false);
  });

  it('getOrCreateConfiguration seeds a missing switch without replacing the stored ones', async () => {
    const { store, insertRawManifest, readRawManifest } = getEnv();
    await insertRawManifest({ tenant_id: 'legacy', manifest_json: LEGACY_MANIFEST_JSON });

    const record = await store.getOrCreateConfiguration({
      tenant_id: 'legacy',
      default_manifest: manifest({ webSearch: true, memory: true }),
    });

    expect(record.manifest).toEqual(SEEDED);
    expect(await readRawManifest('legacy')).toEqual(SEEDED);
  });

  it('leaves a complete row untouched on read', async () => {
    const { store, readRawManifest } = getEnv();
    const saved = await store.upsertConfiguration({
      tenant_id: 'acme',
      manifest: manifest({ webSearch: false, memory: true }),
    });

    expect(await store.getConfiguration('acme')).toEqual(saved);
    expect(await readRawManifest('acme')).toEqual(manifest({ webSearch: false, memory: true }));
  });
}
