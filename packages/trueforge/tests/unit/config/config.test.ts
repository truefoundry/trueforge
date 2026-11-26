import { DEFAULT_ROUTING_QUESTION } from '@truefoundry/trueforge-core/core';
import type { ArtifactsFeature, ServerConfiguration } from '../../../src/config';
import configuration, {
  assertArtifactsStorage,
  buildRedisStandaloneUrl,
  getPublicUiBasePath,
  parseArtifactsFeature,
  parseS3Config,
  parseTrueFoundryModelRouting,
} from '../../../src/config';
import {
  hasTrueFoundrySandboxProviderConfig,
  resolveTrueFoundrySandboxProviderConfig,
} from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';

/** Minimal distributed config slice for resolve tests (unused fields are irrelevant). */
function distributed(overrides: {
  TRUEFOUNDRY_SANDBOX_ENABLED?: boolean;
  TRUEFOUNDRY_SANDBOX_PROVIDER?: 'daytona' | 'truefoundry';
  TRUEFOUNDRY_SANDBOX_API_KEY?: string;
  TRUEFOUNDRY_SANDBOX_SERVER_URL?: string;
  TRUEFOUNDRY_SANDBOX_SETTINGS?: string;
}): ServerConfiguration {
  return {
    STANDALONE: false,
    TRUEFOUNDRY_SANDBOX_ENABLED: false,
    TRUEFOUNDRY_SANDBOX_PROVIDER: undefined,
    TRUEFOUNDRY_SANDBOX_API_KEY: undefined,
    TRUEFOUNDRY_SANDBOX_SERVER_URL: undefined,
    TRUEFOUNDRY_SANDBOX_SETTINGS: undefined,
    ...overrides,
  } as ServerConfiguration;
}

describe('resolveTrueFoundrySandboxProviderConfig', () => {
  it('returns undefined when sandbox is disabled', () => {
    expect(resolveTrueFoundrySandboxProviderConfig(distributed({}))).toBeUndefined();
  });

  it('returns daytona with parsed settings JSON', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({
            snapshotName: 'snap-1',
            timeoutMs: 90_000,
            autoStopIntervalInMinutes: 10,
          }),
        }),
      ),
    ).toEqual({
      type: 'daytona',
      apiKey: 'dtn-key',
      settings: {
        snapshotName: 'snap-1',
        timeoutMs: 90_000,
        autoStopIntervalInMinutes: 10,
        autoArchiveIntervalInMinutes: 60,
        autoDeleteIntervalInMinutes: 43_200,
      },
    });
  });

  it('returns truefoundry with server URL and nats_bridge_url from settings', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SERVER_URL: 'http://sandbox-server',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toEqual({
      type: 'truefoundry',
      serverUrl: 'http://sandbox-server',
      natsBridgeUrl: 'ws://nats-bridge',
    });
  });

  it('throws when daytona is enabled without API key', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ snapshotName: 'snap-1' }),
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_API_KEY/);
  });

  it('throws when truefoundry is enabled without server URL', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_SERVER_URL/);
  });

  it('throws when settings JSON is invalid', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS: '{not-json',
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_SETTINGS must be valid JSON/);
  });
});

describe('hasTrueFoundrySandboxProviderConfig', () => {
  it('returns true when shared provider config resolves', () => {
    expect(
      hasTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SERVER_URL: 'http://sandbox-server',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toBe(true);
  });

  it('returns false when sandbox is disabled', () => {
    expect(hasTrueFoundrySandboxProviderConfig(distributed({}))).toBe(false);
  });

  it('returns false instead of throwing when settings are incomplete', () => {
    expect(
      hasTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toBe(false);
  });

  it('returns false instead of throwing when settings JSON is invalid', () => {
    expect(
      hasTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS: '{not-json',
        }),
      ),
    ).toBe(false);
  });
});

describe('getPublicUiBasePath', () => {
  it('ignores a path-bearing PUBLIC_BASE_URL in standalone non-development', () => {
    expect(
      getPublicUiBasePath({
        STANDALONE: true,
        NODE_ENV: 'production',
        PORT: 8790,
        PUBLIC_BASE_URL: 'https://host.example/custom/proxy/path',
      } as ServerConfiguration),
    ).toBe('/');
  });

  it('honors PUBLIC_BASE_URL pathname in standalone development', () => {
    expect(
      getPublicUiBasePath({
        STANDALONE: true,
        NODE_ENV: 'development',
        PUBLIC_BASE_URL: 'https://host.example/custom/proxy/path',
      } as ServerConfiguration),
    ).toBe('/custom/proxy/path/');
  });
});

describe('buildRedisStandaloneUrl', () => {
  const base = {
    port: 6379,
    database: 0,
    username: undefined,
    password: undefined,
    tls: false,
  };

  it('builds a hostname URL', () => {
    expect(buildRedisStandaloneUrl({ ...base, host: 'redis.internal' })).toBe('redis://redis.internal:6379/0');
  });

  it('brackets bare IPv6 hosts so the URL is parseable', () => {
    const url = buildRedisStandaloneUrl({ ...base, host: '::1' });
    expect(url).toBe('redis://[::1]:6379/0');
    expect(() => new URL(url)).not.toThrow();
  });

  it('keeps already-bracketed IPv6 hosts', () => {
    expect(buildRedisStandaloneUrl({ ...base, host: '[2001:db8::1]', port: 6380, database: 2 })).toBe(
      'redis://[2001:db8::1]:6380/2',
    );
  });

  it('leaves IPv4 hosts unbracketed', () => {
    expect(buildRedisStandaloneUrl({ ...base, host: '127.0.0.1' })).toBe('redis://127.0.0.1:6379/0');
  });
});

describe('parseS3Config', () => {
  it('returns undefined when unset', () => {
    expect(parseS3Config(undefined)).toBeUndefined();
    expect(parseS3Config('  ')).toBeUndefined();
  });

  it('reads the bucket with defaults', () => {
    expect(parseS3Config(JSON.stringify({ bucket: 'b' }))).toEqual({
      bucket: 'b',
      prefix: '',
      presign_ttl_seconds: 300,
    });
  });

  it.each([
    ['missing bucket', {}],
    ['unknown key', { bucket: 'b', extra: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseS3Config(JSON.stringify(value))).toThrow('S3_CONFIG');
  });
});

describe('parseArtifactsFeature', () => {
  it('returns undefined when unset', () => {
    expect(parseArtifactsFeature(undefined)).toBeUndefined();
    expect(parseArtifactsFeature('  ')).toBeUndefined();
  });

  it('reads the per-tenant flag', () => {
    expect(parseArtifactsFeature(JSON.stringify({ tenants: { internal: { enabled: 'on' }, other: {} } }))).toEqual({
      tenants: { internal: { enabled: 'on' }, other: { enabled: 'off' } },
    });
  });

  it('rejects a bad flag value', () => {
    expect(() => parseArtifactsFeature(JSON.stringify({ tenants: { a: { enabled: 'yes' } } }))).toThrow('ARTIFACTS');
  });
});

describe('assertArtifactsStorage', () => {
  const artifacts: ArtifactsFeature = { tenants: { a: { enabled: 'on' } } };

  it('requires S3_CONFIG when ARTIFACTS is set', () => {
    expect(() => assertArtifactsStorage({ ...configuration, ARTIFACTS: artifacts, S3_CONFIG: undefined })).toThrow(
      'S3_CONFIG',
    );
  });

  it('passes when ARTIFACTS is unset or S3_CONFIG is set', () => {
    expect(() =>
      assertArtifactsStorage({ ...configuration, ARTIFACTS: undefined, S3_CONFIG: undefined }),
    ).not.toThrow();
    expect(() =>
      assertArtifactsStorage({
        ...configuration,
        ARTIFACTS: artifacts,
        S3_CONFIG: { bucket: 'b', prefix: '', presign_ttl_seconds: 300 },
      }),
    ).not.toThrow();
  });
});

describe('parseTrueFoundryModelRouting', () => {
  it('returns undefined when unset', () => {
    expect(parseTrueFoundryModelRouting(undefined)).toBeUndefined();
    expect(parseTrueFoundryModelRouting('  ')).toBeUndefined();
  });

  it('reads the shared decision model and the per-tenant enabled flag', () => {
    const parsed = parseTrueFoundryModelRouting(
      JSON.stringify({
        decision_model: { name: 'typesafe/jev-1.13.0', api_key: 'test-routing-key' },
        tenants: { internal: { enabled: 'on' } },
      }),
    );
    expect(parsed?.decision_model).toEqual({
      name: 'typesafe/jev-1.13.0',
      api_key: 'test-routing-key',
    });
    expect(parsed?.tenants['internal']).toEqual({ enabled: 'on' });
  });

  describe('categories', () => {
    const routing = (categories?: Record<string, string>) =>
      JSON.stringify({
        decision_model: { name: 'typesafe/jev-1.13.0', api_key: 'test-routing-key' },
        tenants: { internal: { enabled: 'on' } },
        ...(categories === undefined ? {} : { categories }),
      });
    const three = { direct: 'd', fixed_steps: 'f', adaptive: 'a' };

    it('defaults to the tested four when unset', () => {
      expect(parseTrueFoundryModelRouting(routing())?.categories).toEqual(DEFAULT_ROUTING_QUESTION.categories);
    });

    it('keeps the default frontier meaning when only the original three are overridden', () => {
      expect(parseTrueFoundryModelRouting(routing(three))?.categories).toEqual({
        ...three,
        frontier: DEFAULT_ROUTING_QUESTION.categories.frontier,
      });
    });

    it('overrides the frontier meaning, and rejects unknown categories', () => {
      expect(parseTrueFoundryModelRouting(routing({ ...three, frontier: 'f!' }))?.categories.frontier).toBe('f!');
      expect(() => parseTrueFoundryModelRouting(routing({ ...three, extra: 'x' }))).toThrow(
        'Environment variable TRUEFOUNDRY_MODEL_ROUTING must be a JSON object',
      );
    });
  });

  it('rejects a decision model without its api_key', () => {
    expect(() =>
      parseTrueFoundryModelRouting(
        JSON.stringify({
          decision_model: { name: 'typesafe/jev-1.13.0' },
          tenants: { internal: { enabled: 'on' } },
        }),
      ),
    ).toThrow('Environment variable TRUEFOUNDRY_MODEL_ROUTING must be a JSON object');
  });
});
