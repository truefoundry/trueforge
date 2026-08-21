import {
  SandboxProviderManifestSchema,
  toDaytonaSandboxProviderInput,
  toE2BSandboxProviderInput,
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

describe('E2B sandbox provider schema', () => {
  it('parses and maps provider-specific timeout settings', () => {
    const manifest = SandboxProviderManifestSchema.parse({
      type: 'e2b',
      auth: { api_key: 'e2b-test' },
      exec_timeout_ms: 60_000,
      sandbox_timeout_ms: 300_000,
    });
    if (manifest.type !== 'e2b') {
      throw new Error('Expected an E2B manifest');
    }

    expect(toE2BSandboxProviderInput(manifest)).toEqual({
      apiKey: 'e2b-test',
      execTimeoutMs: 60_000,
      sandboxTimeoutMs: 300_000,
    });
  });

  it('rejects Daytona lifecycle fields on E2B manifests', () => {
    expect(() =>
      SandboxProviderManifestSchema.parse({
        type: 'e2b',
        auth: { api_key: 'e2b-test' },
        exec_timeout_ms: 60_000,
        sandbox_timeout_ms: 300_000,
        auto_archive_interval_in_minutes: 60,
      }),
    ).toThrow();
  });
});
