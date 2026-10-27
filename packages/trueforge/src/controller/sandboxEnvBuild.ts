/**
 * Control loop: list pending sandbox-env versions and hand each to the server over HTTP.
 */
import { TrueForgeApi, TrueForgeError } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import type { ControlLoop } from './Controller';
import { internalTrueForgeClient } from './internalTrueForgeClient';

const SANDBOX_ENV_BUILD_INTERVAL_MS = 5_000;
const SANDBOX_ENV_BUILD_LOOP_NAME = 'sandbox-env-build';

export async function dispatchSandboxEnvBuilds({ logger }: { logger: Logger }): Promise<void> {
  const pending = await internalTrueForgeClient.listPendingSandboxEnvironmentVersions();
  logger.debug('Sandbox environment build tick', { pending_count: pending.length });
  for (const environmentVersionId of pending) {
    logger.debug('Progressing sandbox environment version', { environment_version_id: environmentVersionId });
    try {
      await internalTrueForgeClient.progressSandboxEnvironmentVersion(environmentVersionId);
      logger.debug('Sandbox environment version progress completed', {
        environment_version_id: environmentVersionId,
      });
    } catch (error) {
      if (error instanceof TrueForgeApi.NotFoundError) {
        logger.warn('Sandbox environment version not found; skipping', {
          environment_version_id: environmentVersionId,
        });
        continue;
      }
      // A status means the API handler already logged the failure. Report a call that got no response.
      const serverResponded = error instanceof TrueForgeError && typeof error.statusCode === 'number';
      logger.error('Sandbox environment version progress failed', {
        environment_version_id: environmentVersionId,
        error: error instanceof Error ? error.message : String(error),
        ...(serverResponded
          ? {}
          : {
              reportable_error: {
                error,
                extra: { environment_version_id: environmentVersionId },
              },
            }),
      });
    }
  }
}

export function sandboxEnvBuildLoop(params: { logger: Logger }): ControlLoop {
  return {
    name: SANDBOX_ENV_BUILD_LOOP_NAME,
    intervalMs: SANDBOX_ENV_BUILD_INTERVAL_MS,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      await dispatchSandboxEnvBuilds({ logger: params.logger });
    },
  };
}
