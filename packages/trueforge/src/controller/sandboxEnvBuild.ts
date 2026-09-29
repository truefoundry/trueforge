/**
 * Control loop: list pending sandbox-env versions and hand each to the server over HTTP.
 */
import { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import configuration from '../config';
import { createTlsFetch, normalizeTlsUrl } from '../http/tls';
import type { ControlLoop } from './Controller';

export const SANDBOX_ENV_BUILD_BATCH_LIMIT = 20;
const SANDBOX_ENV_BUILD_INTERVAL_MS = 30_000;
const SANDBOX_ENV_BUILD_LOOP_NAME = 'sandbox-env-build';

export interface SandboxEnvPendingItem {
  environment_version_id: string;
}

export interface SandboxEnvBuildClient {
  listPending: (limit: number) => Promise<SandboxEnvPendingItem[]>;
  progress: (item: SandboxEnvPendingItem) => Promise<void>;
}

/** HTTP handoff to internal sandbox-environment build routes. */
export function createHttpSandboxEnvBuildClient(): SandboxEnvBuildClient {
  const tls = {
    enabled: configuration.MTLS_ENABLED,
    dir: configuration.MTLS_CERTS_DIR,
  };
  const tlsFetch = createTlsFetch(tls);
  const client = new TrueForge({
    baseUrl: normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: tls.enabled }),
    token: configuration.TRUEFORGE_API_KEY,
    timeoutInSeconds: 60,
    ...(tlsFetch === undefined ? {} : { fetch: tlsFetch }),
  });

  return {
    async listPending(limit) {
      const response = await client.internal.sandboxEnvironments.listPending({ limit });
      return response.data.map(row => ({
        environment_version_id: row.environmentVersionId,
      }));
    },
    async progress(item) {
      try {
        await client.internal.sandboxEnvironments.progress({
          environmentVersionId: item.environment_version_id,
        });
      } catch (error) {
        // Missing version is a no-op (already progressed or deleted).
        if (error instanceof TrueForgeApi.NotFoundError) {
          return;
        }
        throw error;
      }
    },
  };
}

export async function dispatchSandboxEnvBuilds({
  client,
  logger,
  limit = SANDBOX_ENV_BUILD_BATCH_LIMIT,
}: {
  client: SandboxEnvBuildClient;
  logger: Logger;
  limit?: number;
}): Promise<void> {
  const pending = await client.listPending(limit);
  for (const item of pending) {
    try {
      await client.progress(item);
    } catch (error) {
      logger.error('Sandbox environment version progress failed', {
        environment_version_id: item.environment_version_id,
        error: error instanceof Error ? error.message : String(error),
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
