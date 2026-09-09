import { HTTPException } from 'hono/http-exception';
import type { ServerConfiguration } from '../../../src/config';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';

/** Minimal distributed config slice for resolve tests (unused fields are irrelevant). */
function distributed(overrides: {
  TRUEFOUNDRY_SANDBOX_ENABLED?: boolean;
  TRUEFOUNDRY_SANDBOX_API_KEY?: string;
  TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL?: string;
  TFY_SANDBOX_SERVER_URL?: string;
  TFY_SANDBOX_NATS_BRIDGE_URL?: string;
}): ServerConfiguration {
  return {
    STANDALONE: false,
    TRUEFOUNDRY_SANDBOX_ENABLED: false,
    TRUEFOUNDRY_SANDBOX_API_KEY: undefined,
    TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL: undefined,
    TFY_SANDBOX_SERVER_URL: undefined,
    TFY_SANDBOX_NATS_BRIDGE_URL: undefined,
    ...overrides,
  } as ServerConfiguration;
}

describe('resolveTrueFoundrySandboxProviderConfig', () => {
  it('throws in standalone mode', () => {
    expect(() => resolveTrueFoundrySandboxProviderConfig({ STANDALONE: true } as ServerConfiguration)).toThrow(
      HTTPException,
    );
  });

  it('returns undefined when sandbox is disabled', () => {
    expect(resolveTrueFoundrySandboxProviderConfig(distributed({}))).toBeUndefined();
  });

  it('returns daytona when Daytona env is complete', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL: 'https://settings.example',
        }),
      ),
    ).toEqual({
      type: 'daytona',
      apiKey: 'dtn-key',
      settingsServerUrl: 'https://settings.example',
    });
  });

  it('returns tfy when TFY env is complete and Daytona is not', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TFY_SANDBOX_SERVER_URL: 'http://sandbox-server',
          TFY_SANDBOX_NATS_BRIDGE_URL: 'ws://nats-bridge',
        }),
      ),
    ).toEqual({
      type: 'truefoundry',
      serverUrl: 'http://sandbox-server',
      natsBridgeUrl: 'ws://nats-bridge',
    });
  });

  it('prefers daytona when both Daytona and TFY env are complete', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL: 'https://settings.example',
          TFY_SANDBOX_SERVER_URL: 'http://sandbox-server',
          TFY_SANDBOX_NATS_BRIDGE_URL: 'ws://nats-bridge',
        }),
      ),
    ).toEqual({
      type: 'daytona',
      apiKey: 'dtn-key',
      settingsServerUrl: 'https://settings.example',
    });
  });

  it('returns undefined when enabled but neither provider env is complete', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TFY_SANDBOX_SERVER_URL: 'http://sandbox-server',
        }),
      ),
    ).toBeUndefined();
  });
});
