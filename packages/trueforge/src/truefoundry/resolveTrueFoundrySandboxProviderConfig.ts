import { HTTPException } from 'hono/http-exception';
import configuration, { type ServerConfiguration } from '../config';

/**
 * Shared sandbox provider selected by env in TrueFoundry mode.
 */
export type TrueFoundrySandboxProviderConfig =
  | { type: 'daytona'; apiKey: string; settingsServerUrl: string }
  | { type: 'tfy'; serverUrl: string; natsBridgeUrl: string };

/**
 * Returns the configured shared sandbox provider when env is complete, or undefined.
 * Must only be called outside standalone (TrueFoundry wiring).
 */
export function resolveTrueFoundrySandboxProviderConfig(
  config: ServerConfiguration = configuration,
): TrueFoundrySandboxProviderConfig | undefined {
  if (config.STANDALONE) {
    throw new HTTPException(500, {
      message: 'TrueFoundry sandbox provider config is not available in standalone mode',
    });
  }
  if (!config.TRUEFOUNDRY_SANDBOX_ENABLED) {
    return undefined;
  }
  if (
    config.TRUEFOUNDRY_SANDBOX_API_KEY !== undefined &&
    config.TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL !== undefined
  ) {
    return {
      type: 'daytona',
      apiKey: config.TRUEFOUNDRY_SANDBOX_API_KEY,
      settingsServerUrl: config.TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL,
    };
  }
  if (config.TFY_SANDBOX_SERVER_URL !== undefined && config.TFY_SANDBOX_NATS_BRIDGE_URL !== undefined) {
    return {
      type: 'tfy',
      serverUrl: config.TFY_SANDBOX_SERVER_URL,
      natsBridgeUrl: config.TFY_SANDBOX_NATS_BRIDGE_URL,
    };
  }
  return undefined;
}
