/**
 * Shared TrueForge SDK client for controller → server HTTP handoff (mTLS + API key).
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';
import configuration from '../config';
import { createTlsFetch, normalizeTlsUrl } from '../http/tls';

function createClient(): TrueForge {
  const tls = {
    enabled: configuration.MTLS_ENABLED,
    dir: configuration.MTLS_CERTS_DIR,
  };
  const tlsFetch = createTlsFetch(tls);
  return new TrueForge({
    baseUrl: normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: tls.enabled }),
    token: configuration.TRUEFORGE_API_KEY,
    timeoutInSeconds: 60,
    ...(tlsFetch === undefined ? {} : { fetch: tlsFetch }),
  });
}

const client = createClient();

/** Controller loops share this client for all internal HTTP handoffs. */
export const internalTrueForgeClient = {
  async executeScheduleRun(scheduleRunId: string): Promise<void> {
    await client.internal.schedules.executeRun({ scheduleRunId });
  },

  async listPendingSandboxEnvironmentVersions(): Promise<string[]> {
    const response = await client.internal.sandboxEnvironments.listPending();
    return response.data.map(row => row.environmentVersionId);
  },

  async progressSandboxEnvironmentVersion(environmentVersionId: string): Promise<void> {
    await client.internal.sandboxEnvironments.progress({ environmentVersionId });
  },

  async listAbandonedTurns(): Promise<{ tenantId: string; sessionId: string; turnId: string }[]> {
    const response = await client.internal.turns.listAbandoned();
    return response.data.map(row => ({
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      turnId: row.turnId,
    }));
  },

  async closeAbandonedTurn(input: { tenantId: string; sessionId: string; turnId: string }): Promise<void> {
    await client.internal.turns.closeAbandoned({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
  },
};
