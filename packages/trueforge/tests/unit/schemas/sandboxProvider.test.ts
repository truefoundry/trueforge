import {
  toDaytonaSandboxProviderInput,
  toOpenSandboxProviderInput,
  type DaytonaSandboxProvider,
  type OpenSandboxProvider,
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

  it('maps an OpenSandbox wire/DB manifest to SDK settings', () => {
    const manifest: OpenSandboxProvider = {
      type: 'opensandbox',
      auth: { api_key: 'osb-test' },
      domain: 'localhost:8080',
      protocol: 'http',
      exec_timeout_ms: 60_000,
    };

    expect(toOpenSandboxProviderInput(manifest)).toEqual({
      apiKey: 'osb-test',
      domain: 'localhost:8080',
      protocol: 'http',
      timeoutMs: 60_000,
    });
  });
});
