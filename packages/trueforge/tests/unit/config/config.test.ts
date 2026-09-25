import type { ServerConfiguration } from '../../../src/config';
import { buildRedisStandaloneUrl, getPublicUiBasePath, isEnvSandboxProviderEnabled } from '../../../src/config';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';

/** Minimal distributed config slice for resolve tests (unused fields are irrelevant). */
function distributed(overrides: {
  TRUEFOUNDRY_SANDBOX_ENABLED?: boolean;
  TRUEFOUNDRY_SANDBOX_PROVIDER?: 'daytona' | 'truefoundry' | 'kubernetes';
  TRUEFOUNDRY_SANDBOX_API_KEY?: string;
  TRUEFOUNDRY_SANDBOX_SERVER_URL?: string;
  TRUEFOUNDRY_SANDBOX_SETTINGS?: string;
  KUBERNETES_SANDBOX_NAMESPACE?: string;
  KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME?: string;
  KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME?: string;
  KUBERNETES_SANDBOX_RESOURCES?: string;
  KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS?: number;
  KUBERNETES_SANDBOX_POLL_INTERVAL_MS?: number;
  KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS?: number;
  KUBERNETES_SANDBOX_REAPER_TTL_MS?: number;
  KUBERNETES_SANDBOX_IN_CLUSTER?: boolean;
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

  it('returns Kubernetes settings from environment-backed configuration', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'kubernetes',
          KUBERNETES_SANDBOX_NAMESPACE: 'sandboxes',
          KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME: 'sandbox-runner',
          KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS: 90_000,
          KUBERNETES_SANDBOX_IN_CLUSTER: true,
        }),
      ),
    ).toMatchObject({
      type: 'kubernetes',
      namespace: 'sandboxes',
      serviceAccountName: 'sandbox-runner',
      execTimeoutMs: 90_000,
      inCluster: true,
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

describe('isEnvSandboxProviderEnabled', () => {
  it('is false in standalone mode, even with TRUEFOUNDRY_SANDBOX_ENABLED true', () => {
    // The predicate short-circuits on `!config.STANDALONE` — override just that discriminant on
    // an otherwise-distributed-shaped fixture so the overlap stays honest for the union type.
    expect(
      isEnvSandboxProviderEnabled({
        ...distributed({ TRUEFOUNDRY_SANDBOX_ENABLED: true }),
        STANDALONE: true,
      } as ServerConfiguration),
    ).toBe(false);
  });

  it('is false in distributed mode when TRUEFOUNDRY_SANDBOX_ENABLED is unset', () => {
    expect(isEnvSandboxProviderEnabled(distributed({}))).toBe(false);
  });

  it('is true in distributed mode when TRUEFOUNDRY_SANDBOX_ENABLED is true — self-host, no TrueFoundry control plane required', () => {
    expect(
      isEnvSandboxProviderEnabled(
        distributed({ TRUEFOUNDRY_SANDBOX_ENABLED: true, TRUEFOUNDRY_SANDBOX_PROVIDER: 'kubernetes' }),
      ),
    ).toBe(true);
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
