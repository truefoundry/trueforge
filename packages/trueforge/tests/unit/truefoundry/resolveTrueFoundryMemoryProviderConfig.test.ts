import { ZEP_DEFAULT_BASE_URL } from '../../../src/memory/zep/ZepMemoryProvider';
import { resolveTrueFoundryMemoryProviderConfig } from '../../../src/truefoundry/resolveTrueFoundryMemoryProviderConfig';

const OFF = {
  TRUEFOUNDRY_MEMORY_ENABLED: false,
  TRUEFOUNDRY_MEMORY_PROVIDER: undefined,
  TRUEFOUNDRY_MEMORY_API_KEY: undefined,
  TRUEFOUNDRY_MEMORY_SERVER_URL: undefined,
} as const;

describe('resolveTrueFoundryMemoryProviderConfig', () => {
  it('returns undefined when memory is disabled, even with a provider set', () => {
    expect(
      resolveTrueFoundryMemoryProviderConfig({
        ...OFF,
        TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
        TRUEFOUNDRY_MEMORY_API_KEY: 'k',
      }),
    ).toBeUndefined();
  });

  it('returns zep with the Zep Cloud URL by default', () => {
    expect(
      resolveTrueFoundryMemoryProviderConfig({
        ...OFF,
        TRUEFOUNDRY_MEMORY_ENABLED: true,
        TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
        TRUEFOUNDRY_MEMORY_API_KEY: 'zep-key',
      }),
    ).toEqual({ type: 'zep', apiKey: 'zep-key', serverUrl: ZEP_DEFAULT_BASE_URL });
  });

  it('uses TRUEFOUNDRY_MEMORY_SERVER_URL when set', () => {
    expect(
      resolveTrueFoundryMemoryProviderConfig({
        ...OFF,
        TRUEFOUNDRY_MEMORY_ENABLED: true,
        TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
        TRUEFOUNDRY_MEMORY_API_KEY: 'zep-key',
        TRUEFOUNDRY_MEMORY_SERVER_URL: 'https://zep.internal/api/v4',
      }),
    ).toEqual({ type: 'zep', apiKey: 'zep-key', serverUrl: 'https://zep.internal/api/v4' });
  });

  it('requires an API key for zep', () => {
    expect(() =>
      resolveTrueFoundryMemoryProviderConfig({
        ...OFF,
        TRUEFOUNDRY_MEMORY_ENABLED: true,
        TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
      }),
    ).toThrow('TRUEFOUNDRY_MEMORY_API_KEY is required when TRUEFOUNDRY_MEMORY_PROVIDER is zep');
  });
});
