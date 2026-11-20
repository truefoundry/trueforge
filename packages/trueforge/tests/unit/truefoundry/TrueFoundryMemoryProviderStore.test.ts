import { TRUEFOUNDRY_MANAGED_STATUS } from '../../../src/truefoundry/errors';
import {
  TrueFoundryMemoryProviderStore,
  type TrueFoundryMemoryEnv,
} from '../../../src/truefoundry/TrueFoundryMemoryProviderStore';

function env(overrides: Partial<TrueFoundryMemoryEnv> = {}): TrueFoundryMemoryEnv {
  return {
    TRUEFOUNDRY_MEMORY_ENABLED: true,
    TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
    TRUEFOUNDRY_MEMORY_API_KEY: 'zep-shared-key',
    TRUEFOUNDRY_MEMORY_SERVER_URL: undefined,
    TRUEFOUNDRY_MEMORY_SETTINGS: undefined,
    TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST: [],
    ...overrides,
  };
}

describe('TrueFoundryMemoryProviderStore', () => {
  it('returns the platform Zep for every tenant when the allowlist is empty', async () => {
    const store = new TrueFoundryMemoryProviderStore(env());
    await expect(store.getProvider('acme')).resolves.toMatchObject({
      tenant_id: 'acme',
      manifest: { type: 'zep', auth: { api_key: 'zep-shared-key' } },
    });
  });

  it('carries the server URL when one is set', async () => {
    const store = new TrueFoundryMemoryProviderStore(
      env({ TRUEFOUNDRY_MEMORY_SERVER_URL: 'https://zep.internal/api/v4' }),
    );
    await expect(store.getProvider('acme')).resolves.toMatchObject({
      manifest: { type: 'zep', server_url: 'https://zep.internal/api/v4' },
    });
  });

  it('returns nothing while TRUEFOUNDRY_MEMORY_ENABLED is off', async () => {
    const store = new TrueFoundryMemoryProviderStore(env({ TRUEFOUNDRY_MEMORY_ENABLED: false }));
    await expect(store.getProvider('acme')).resolves.toBeUndefined();
  });

  it('returns the provider only to allowlisted tenants', async () => {
    const store = new TrueFoundryMemoryProviderStore(env({ TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST: ['acme'] }));
    await expect(store.getProvider('acme')).resolves.toBeDefined();
    await expect(store.getProvider('globex')).resolves.toBeUndefined();
  });

  it('rejects writes because the platform manages the provider', async () => {
    const store = new TrueFoundryMemoryProviderStore(env());
    expect(() =>
      store.upsertProvider({ tenant_id: 'acme', manifest: { type: 'zep', auth: { api_key: 'tenant-key' } } }),
    ).toThrow(expect.objectContaining({ status: TRUEFOUNDRY_MANAGED_STATUS }));
  });
});
