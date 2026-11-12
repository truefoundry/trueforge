import { createLogger } from 'winston';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteConfigurationStore } from '../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';
import { SqliteMemoryProviderStore } from '../../../src/db/sqlite/memory-provider-store/SqliteMemoryProviderStore';
import {
  listTenantMemoryProviders,
  MemoryProviderCache,
  resolveTenantMemoryProvider,
  type TenantMemoryDeps,
} from '../../../src/memory/providers';
import type { MemoryProviderManifest } from '../../../src/schemas/memoryProvider';
import { TrueFoundryMemoryProviderStore } from '../../../src/truefoundry/TrueFoundryMemoryProviderStore';

const ZEP: MemoryProviderManifest = { type: 'zep', auth: { api_key: 'zep-test-key' } };

async function setup() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const configurationStore = new SqliteConfigurationStore(db);
  const memoryProviderStore = new SqliteMemoryProviderStore(db);
  const deps: TenantMemoryDeps = {
    memoryProviderStore,
    configurationStore,
    providers: new MemoryProviderCache({ logger: createLogger({ silent: true }) }),
  };
  const setSwitch = (tenant_id: string, enabled: boolean) =>
    configurationStore.upsertConfiguration({
      tenant_id,
      manifest: { web_search: { enabled: true }, memory: { enabled } },
    });
  return { deps, memoryProviderStore, setSwitch };
}

describe('MemoryProviderCache', () => {
  it('reuses one provider per manifest and builds a new one when the key rotates', () => {
    const cache = new MemoryProviderCache({ logger: createLogger({ silent: true }) });

    const first = cache.get(ZEP);
    expect(cache.get({ ...ZEP })).toBe(first);
    expect(cache.get({ ...ZEP, auth: { api_key: 'rotated' } })).not.toBe(first);
  });
});

describe('resolveTenantMemoryProvider', () => {
  it('returns the saved provider once the tenant switch is on', async () => {
    const { deps, memoryProviderStore, setSwitch } = await setup();
    await memoryProviderStore.upsertProvider({ tenant_id: 'acme', manifest: ZEP });
    await setSwitch('acme', true);

    await expect(resolveTenantMemoryProvider({ tenant_id: 'acme', ...deps })).resolves.toBe(deps.providers.get(ZEP));
  });

  it('returns the provider by default, and nothing once the switch is turned off', async () => {
    const { deps, memoryProviderStore, setSwitch } = await setup();
    await memoryProviderStore.upsertProvider({ tenant_id: 'acme', manifest: ZEP });

    await expect(resolveTenantMemoryProvider({ tenant_id: 'acme', ...deps })).resolves.toBe(deps.providers.get(ZEP));
    await setSwitch('acme', false);
    await expect(resolveTenantMemoryProvider({ tenant_id: 'acme', ...deps })).resolves.toBeUndefined();
  });

  it('returns nothing without a provider, even with the switch on', async () => {
    const { deps, setSwitch } = await setup();
    await setSwitch('acme', true);

    await expect(resolveTenantMemoryProvider({ tenant_id: 'acme', ...deps })).resolves.toBeUndefined();
  });
});

describe('listTenantMemoryProviders', () => {
  it('maps each tenant with its switch on and a provider to that provider', async () => {
    const { deps, memoryProviderStore, setSwitch } = await setup();
    const otherZep: MemoryProviderManifest = { ...ZEP, auth: { api_key: 'other-key' } };
    await memoryProviderStore.upsertProvider({ tenant_id: 'acme', manifest: ZEP });
    await memoryProviderStore.upsertProvider({ tenant_id: 'globex', manifest: otherZep });
    await memoryProviderStore.upsertProvider({ tenant_id: 'switched-off', manifest: ZEP });
    await setSwitch('acme', true);
    await setSwitch('globex', true);
    await setSwitch('no-provider', true);
    await setSwitch('switched-off', false);

    const providers = await listTenantMemoryProviders(deps);

    expect([...providers.keys()].sort()).toEqual(['acme', 'globex']);
    expect(providers.get('acme')).toBe(deps.providers.get(ZEP));
    expect(providers.get('globex')).toBe(deps.providers.get(otherZep));
  });

  it("in TrueFoundry mode, gives the platform's provider only to allowlisted tenants with the switch on", async () => {
    const { deps, setSwitch } = await setup();
    await setSwitch('acme', true);
    await setSwitch('globex', true);
    const memoryProviderStore = new TrueFoundryMemoryProviderStore({
      TRUEFOUNDRY_MEMORY_ENABLED: true,
      TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
      TRUEFOUNDRY_MEMORY_API_KEY: 'platform-key',
      TRUEFOUNDRY_MEMORY_SERVER_URL: undefined,
      TRUEFOUNDRY_MEMORY_SETTINGS: undefined,
      TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST: ['acme'],
    });

    const providers = await listTenantMemoryProviders({ ...deps, memoryProviderStore });

    expect([...providers.keys()]).toEqual(['acme']);
  });
});
