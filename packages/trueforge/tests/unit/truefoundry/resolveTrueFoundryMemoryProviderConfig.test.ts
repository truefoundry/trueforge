import { ZEP_DEFAULT_BASE_URL } from '../../../src/memory/zep/ZepMemoryProvider';
import { resolveTrueFoundryMemoryProviderConfig } from '../../../src/truefoundry/resolveTrueFoundryMemoryProviderConfig';

const OFF = {
  TRUEFOUNDRY_MEMORY_ENABLED: false,
  TRUEFOUNDRY_MEMORY_PROVIDER: undefined,
  TRUEFOUNDRY_MEMORY_API_KEY: undefined,
  TRUEFOUNDRY_MEMORY_SERVER_URL: undefined,
  TRUEFOUNDRY_MEMORY_SETTINGS: undefined,
} as const;

const DEFAULT_SETTINGS = {
  interval_ms: 300_000,
  max_sessions_per_run: 50,
  max_exchanges_per_session: 20,
  lookback_ms: 7_200_000,
  pause_timeout_ms: 43_200_000,
};

const ZEP_ON = {
  ...OFF,
  TRUEFOUNDRY_MEMORY_ENABLED: true,
  TRUEFOUNDRY_MEMORY_PROVIDER: 'zep',
  TRUEFOUNDRY_MEMORY_API_KEY: 'zep-key',
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
    ).toEqual({ type: 'zep', apiKey: 'zep-key', serverUrl: ZEP_DEFAULT_BASE_URL, settings: DEFAULT_SETTINGS });
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
    ).toEqual({
      type: 'zep',
      apiKey: 'zep-key',
      serverUrl: 'https://zep.internal/api/v4',
      settings: DEFAULT_SETTINGS,
    });
  });

  it('reads loop settings from TRUEFOUNDRY_MEMORY_SETTINGS, keeping defaults for the rest', () => {
    expect(
      resolveTrueFoundryMemoryProviderConfig({
        ...ZEP_ON,
        TRUEFOUNDRY_MEMORY_SETTINGS: '{"interval_ms":30000,"max_sessions_per_run":10}',
      })?.settings,
    ).toEqual({ ...DEFAULT_SETTINGS, interval_ms: 30_000, max_sessions_per_run: 10 });
  });

  it.each([
    ['invalid JSON', '{not json', 'TRUEFOUNDRY_MEMORY_SETTINGS must be valid JSON'],
    ['an unknown key', '{"interval":1}', 'Unrecognized key'],
    ['a non-positive value', '{"interval_ms":0}', 'Too small'],
  ])('rejects settings with %s', (_label, raw, message) => {
    expect(() => resolveTrueFoundryMemoryProviderConfig({ ...ZEP_ON, TRUEFOUNDRY_MEMORY_SETTINGS: raw })).toThrow(
      message,
    );
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
