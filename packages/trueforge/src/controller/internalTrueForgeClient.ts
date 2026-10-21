/**
 * Shared TrueForge SDK client for controller → server HTTP handoff (mTLS + API key).
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';
import configuration from '../config';
import { internalTlsFetch, normalizeTlsUrl } from '../http/tls';

function createClient(): TrueForge {
  return new TrueForge({
    baseUrl: normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: configuration.MTLS_ENABLED }),
    token: configuration.TRUEFORGE_API_KEY,
    timeoutInSeconds: 60,
    fetch: internalTlsFetch(configuration),
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
};
