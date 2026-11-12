import configuration, { isTrueFoundryModeEnabled } from '../../config';

/**
 * Environments UI/CRUD and AgentSpec environment_name requirement — matches
 * `envSupported` on the sandbox-environment store. Standalone/OIDC persistence
 * always supports envs; TFY mode only when the shared provider is Daytona.
 */
export function sandboxEnvironmentsEnabled(): boolean {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return true;
  }
  return configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === 'daytona';
}
