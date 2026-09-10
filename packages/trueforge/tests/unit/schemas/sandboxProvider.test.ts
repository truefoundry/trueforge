import {
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
