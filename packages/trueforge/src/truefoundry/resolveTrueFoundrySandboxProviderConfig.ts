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
 * Returns the configured shared sandbox provider when `TRUEFOUNDRY_SANDBOX_ENABLED`, or undefined.
 * Prefer Daytona when `TRUEFOUNDRY_SANDBOX_API_KEY` + `TRUEFOUNDRY_SANDBOX_SETTINGS_SERVER_URL` are set.
 */
export function resolveTrueFoundrySandboxProviderConfig(
  config: ServerConfiguration = configuration,
): TrueFoundrySandboxProviderConfig | undefined {
  if (config.STANDALONE || !config.TRUEFOUNDRY_SANDBOX_ENABLED) {
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
  return undefined;
}
