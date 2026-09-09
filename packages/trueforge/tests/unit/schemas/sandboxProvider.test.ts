import {
  ConfiguredSandboxProviderSchema,
  SandboxProviderManifestSchema,
  UpdateSandboxProviderRequestSchema,
  toDaytonaSandboxProviderInput,
  type DaytonaSandboxProvider,
} from '../../../src/schemas/sandboxProvider';

describe('toDaytonaSandboxProviderInput', () => {
  it('maps a Daytona wire/DB manifest to apiKey plus provider settings', () => {
    const manifest: DaytonaSandboxProvider = {
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

describe('SandboxProviderManifestSchema (store/runtime)', () => {
  it('parses a truefoundry manifest for internal store use', () => {
    expect(
      SandboxProviderManifestSchema.parse({
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

describe('settings wire schemas (Daytona-only)', () => {
  const daytonaManifest = {
    type: 'daytona' as const,
    auth: { api_key: 'dtn-test' },
    exec_timeout_ms: 60_000,
    auto_stop_interval_in_minutes: 5,
    auto_archive_interval_in_minutes: 60,
    auto_delete_interval_in_minutes: 7200,
  };

  const truefoundryManifest = {
    type: 'truefoundry' as const,
    server_url: 'http://sandbox-server',
    nats_bridge_url: 'ws://nats-bridge',
    exec_timeout_ms: 60_000,
  };

  it('ConfiguredSandboxProvider accepts Daytona and rejects truefoundry', () => {
    expect(
      ConfiguredSandboxProviderSchema.parse({
        manifest: daytonaManifest,
        status: 'ready',
        status_reason: null,
      }),
    ).toMatchObject({ manifest: { type: 'daytona' } });

    expect(() =>
      ConfiguredSandboxProviderSchema.parse({
        manifest: truefoundryManifest,
        status: 'ready',
        status_reason: null,
      }),
    ).toThrow();
  });

  it('UpdateSandboxProviderRequest accepts Daytona and rejects truefoundry', () => {
    expect(UpdateSandboxProviderRequestSchema.parse({ manifest: daytonaManifest })).toMatchObject({
      manifest: { type: 'daytona' },
    });
    expect(() => UpdateSandboxProviderRequestSchema.parse({ manifest: truefoundryManifest })).toThrow();
  });
});
