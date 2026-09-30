/**
 * Control loop: list pending sandbox-env versions and hand each to the server over HTTP.
 */
import { TrueForgeApi, type TrueForge } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import { captureCriticalException } from '../sentry';
import type { ControlLoop } from './Controller';
import { createInternalTrueForgeClient } from './internalTrueForgeClient';

const SANDBOX_ENV_BUILD_INTERVAL_MS = 5_000;
const SANDBOX_ENV_BUILD_LOOP_NAME = 'sandbox-env-build';

export interface SandboxEnvBuildClient {
  listPending: () => Promise<string[]>;
  progress: (environmentVersionId: string) => Promise<void>;
}

/** HTTP handoff to internal sandbox-environment build routes. */
export function createHttpSandboxEnvBuildClient(
  client: TrueForge = createInternalTrueForgeClient(),
): SandboxEnvBuildClient {
  return {
    async listPending() {
      const response = await client.internal.sandboxEnvironments.listPending();
      return response.data.map(row => row.environmentVersionId);
    },
    async progress(environmentVersionId) {
      await client.internal.sandboxEnvironments.progress({ environmentVersionId });
    },
  };
}

export async function dispatchSandboxEnvBuilds({
  client,
  logger,
}: {
  client: SandboxEnvBuildClient;
  logger: Logger;
}): Promise<void> {
  const pending = await client.listPending();
  logger.info('Sandbox environment build tick', { pending_count: pending.length });
  for (const environmentVersionId of pending) {
    logger.info('Progressing sandbox environment version', { environment_version_id: environmentVersionId });
    try {
      await client.progress(environmentVersionId);
      logger.info('Sandbox environment version progress completed', {
        environment_version_id: environmentVersionId,
      });
    } catch (error) {
      if (error instanceof TrueForgeApi.NotFoundError) {
        logger.warn('Sandbox environment version not found; skipping', {
          environment_version_id: environmentVersionId,
        });
        captureCriticalException(error, {
          tags: { module: 'sandboxEnvBuild', operation: 'progressNotFound' },
          extra: { environment_version_id: environmentVersionId },
        });
        continue;
      }
      logger.error('Sandbox environment version progress failed', {
        environment_version_id: environmentVersionId,
        error: error instanceof Error ? error.message : String(error),
      });
      captureCriticalException(error, {
        tags: { module: 'sandboxEnvBuild', operation: 'progress' },
        extra: { environment_version_id: environmentVersionId },
      });
    }
  }
}

export function sandboxEnvBuildLoop(params: { logger: Logger; client?: SandboxEnvBuildClient }): ControlLoop {
  const client = params.client ?? createHttpSandboxEnvBuildClient();
  return {
    name: SANDBOX_ENV_BUILD_LOOP_NAME,
    intervalMs: SANDBOX_ENV_BUILD_INTERVAL_MS,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      await dispatchSandboxEnvBuilds({ client, logger: params.logger });
    },
  };
}
