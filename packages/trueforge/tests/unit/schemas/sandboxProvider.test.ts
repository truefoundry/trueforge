import {
  SandboxProviderManifestSchema,
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

describe('SandboxProviderManifestSchema', () => {
  it('parses a TFY manifest', () => {
    expect(
      SandboxProviderManifestSchema.parse({
        type: 'tfy',
        server_url: 'http://sandbox-server',
        nats_bridge_url: 'ws://nats-bridge',
        exec_timeout_ms: 60_000,
      }),
    ).toEqual({
      type: 'tfy',
      server_url: 'http://sandbox-server',
      nats_bridge_url: 'ws://nats-bridge',
      exec_timeout_ms: 60_000,
    });
  });

  it('rejects an unknown provider type', () => {
    expect(() =>
      SandboxProviderManifestSchema.parse({
        type: 'e2b',
        server_url: 'http://x',
      }),
    ).toThrow();
  });
});
