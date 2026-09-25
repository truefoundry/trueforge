import { createLogger } from 'winston';
import { runSandboxProviderContractSuite } from '../../../../../../trueforge-core/tests/core/sandbox/provider/sandboxProviderContractSuite';
import { createKubernetesSandboxProvider } from '../../../../../src/sandbox/kubernetes/createKubernetesSandboxProvider';

describe('KubernetesSandboxProvider (SandboxProvider contract)', () => {
  runSandboxProviderContractSuite(async () => {
    try {
      const provider = await createKubernetesSandboxProvider({
        manifest: {
          type: 'kubernetes',
          namespace: process.env['KUBERNETES_SANDBOX_NAMESPACE'] ?? 'default',
          exec_timeout_ms: 60_000,
        },
        tenantId: 'contract-test',
        fileMaxBytesForDownload: 20 * 1024 * 1024,
        createTimeoutMs: 120_000,
        pollIntervalMs: 1_000,
        reaperTtlMs: 24 * 60 * 60 * 1000,
        inCluster: process.env['KUBERNETES_SANDBOX_IN_CLUSTER'] === 'true',
        logger: createLogger({ silent: true }),
      });
      return { provider, dispose: async () => undefined };
    } catch (error) {
      // This suite is opt-in/manual (no CI job) — fail loudly with the real cause rather than
      // masking it behind Jasmine's `pending()`, which this repo's Jest config does not provide.
      throw new Error(`Kubernetes cluster unavailable: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  });
});
