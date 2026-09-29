/**
 * Control loop: list pending sandbox-env versions and hand each to the server over HTTP.
 *
 * Uses raw fetch until CI regenerates `@truefoundry/trueforge-sdk` for
 * `environment_version_id` on the internal pending/progress routes; then switch
 * to `client.internal.sandboxEnvironments` like schedule dispatch.
 */
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
  const baseUrl = normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: tls.enabled });
  const fetchFn = tlsFetch ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${configuration.TRUEFORGE_API_KEY}`);
    return fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  return {
    async listPending(limit) {
      const response = await request(`/api/internal/sandbox-environments/pending?limit=${String(limit)}`);
      if (!response.ok) {
        throw new Error(`list pending sandbox env versions failed: ${String(response.status)}`);
      }
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
        throw new Error('list pending sandbox env versions returned unexpected body');
      }
      return body.data.flatMap(row => {
        if (
          typeof row !== 'object' ||
          row === null ||
          !('environment_version_id' in row) ||
          typeof row.environment_version_id !== 'string'
        ) {
          return [];
        }
        return [{ environment_version_id: row.environment_version_id }];
      });
    },
    async progress(item) {
      const response = await request('/api/internal/sandbox-environments/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment_version_id: item.environment_version_id,
        }),
      });
      if (response.status === 204 || response.status === 404) {
        return;
      }
      throw new Error(`progress sandbox env version failed: ${String(response.status)}`);
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
