import {
  SandboxProviderManifestSchema,
  StoredSandboxProviderManifestSchema,
  UpdateSandboxProviderRequestSchema,
  toDaytonaSandboxProviderInput,
  type SandboxProviderManifest,
} from '../../../src/schemas/sandboxProvider';

describe('toDaytonaSandboxProviderInput', () => {
  it('maps a Daytona wire/DB manifest to apiKey plus provider settings', () => {
    const manifest: SandboxProviderManifest = {
      type: 'daytona',
      auth: { api_key: 'dtn-test' },
      exec_timeout_ms: 60_000,
      auto_stop_interval_in_minutes: 5,
      auto_archive_interval_in_minutes: 60,
      auto_delete_interval_in_minutes: 7200,
    };

    expect(toDaytonaSandboxProviderInput(manifest)).toEqual({
      apiKey: 'dtn-test',
      timeoutMs: 60_000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
    });
  });

  it('passes a self-hosted api_url through as apiUrl', () => {
    const manifest: SandboxProviderManifest = {
      type: 'daytona',
      auth: { api_key: 'dtn-test' },
      api_url: 'http://localhost:3000/api',
      exec_timeout_ms: 60_000,
      auto_stop_interval_in_minutes: 5,
      auto_archive_interval_in_minutes: 60,
      auto_delete_interval_in_minutes: 7200,
    };

    expect(toDaytonaSandboxProviderInput(manifest)).toMatchObject({ apiUrl: 'http://localhost:3000/api' });
  });
});

describe('SandboxProviderManifestSchema api_url', () => {
  const daytonaBase = {
    type: 'daytona' as const,
    auth: { api_key: 'dtn-test' },
    exec_timeout_ms: 60_000,
    auto_stop_interval_in_minutes: 0,
    auto_archive_interval_in_minutes: 0,
    auto_delete_interval_in_minutes: 0,
  };

  it('keeps api_url optional so Daytona Cloud stays the default', () => {
    expect(SandboxProviderManifestSchema.parse(daytonaBase).api_url).toBeUndefined();
  });

  it('accepts an absolute self-hosted api_url', () => {
    expect(SandboxProviderManifestSchema.parse({ ...daytonaBase, api_url: 'http://localhost:3000/api' }).api_url).toBe(
      'http://localhost:3000/api',
    );
  });

  it('normalizes a trailing slash before the SDK and snapshot POST use the URL', () => {
    const manifest = SandboxProviderManifestSchema.parse({ ...daytonaBase, api_url: 'http://localhost:3000/api/' });
    expect(toDaytonaSandboxProviderInput(manifest).apiUrl).toBe('http://localhost:3000/api');
  });

  it('rejects relative paths, non-HTTP schemes, queries and fragments', () => {
    for (const api_url of [
      '/api',
      'ftp://localhost/api',
      'http://localhost/api?x=1',
      'http://localhost/api?',
      'http://localhost/api#x',
      'http://localhost/api#',
    ]) {
      expect(() => SandboxProviderManifestSchema.parse({ ...daytonaBase, api_url })).toThrow();
    }
  });
});

describe('StoredSandboxProviderManifestSchema', () => {
  it('parses a truefoundry manifest for internal store use', () => {
    expect(
      StoredSandboxProviderManifestSchema.parse({
        type: 'truefoundry',
        server_url: 'http://sandbox-server',
        nats_bridge_url: 'ws://nats-bridge',
        exec_timeout_ms: 60_000,
      }),
    ).toEqual({
      type: 'truefoundry',
      server_url: 'http://sandbox-server',
      nats_bridge_url: 'ws://nats-bridge',
      exec_timeout_ms: 60_000,
    });
  });
});

describe('UpdateSandboxProviderRequestSchema', () => {
  it('rejects a truefoundry manifest (settings PUT is Daytona-only)', () => {
    expect(() =>
      UpdateSandboxProviderRequestSchema.parse({
        manifest: {
          type: 'truefoundry',
          server_url: 'http://sandbox-server',
          nats_bridge_url: 'ws://nats-bridge',
          exec_timeout_ms: 60_000,
        },
      }),
    ).toThrow();
  });
});
