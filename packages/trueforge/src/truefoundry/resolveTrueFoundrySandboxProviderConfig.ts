import { HTTPException } from 'hono/http-exception';
import configuration, { type ServerConfiguration } from '../config';

/**
 * Shared sandbox provider selected by env in TrueFoundry mode.
 * Daytona today; add a `tfy` branch when `TFY_SANDBOX_SERVER_URL` ships.
 */
export interface TrueFoundrySandboxProviderConfig {
  type: 'daytona';
  apiKey: string;
  settingsServerUrl: string;
}

/**
 * Returns the configured shared sandbox provider when Daytona env is complete, or undefined.
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
  if (
    config.TRUEFOUNDRY_SANDBOX_ENABLED &&
    config.TRUEFOUNDRY_SANDBOX_API_KEY !== undefined &&
    config.TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL !== undefined
  ) {
    return {
      type: 'daytona',
      apiKey: config.TRUEFOUNDRY_SANDBOX_API_KEY,
      settingsServerUrl: config.TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL,
    };
  }
  return undefined;
}
