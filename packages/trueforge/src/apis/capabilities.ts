import { OpenAPIHono } from '@hono/zod-openapi';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import { isAdmin, resolveUserContext } from '../auth/identity';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import { checkSnapshotStatus } from '../sandbox/providerUtils';
import type { SandboxBuildStatus } from '../schemas/sandboxProvider';
import { TENANT_ID } from './sessions';

/**
 * Why skills are unavailable, keyed off the sandbox build status.
 * `pending` is transient (retry); everything else (no provider / failed / unknown) reads as not configured.
 */
function skillDisabledReason(status: SandboxBuildStatus | undefined): string {
  if (status === 'pending') {
    return 'Skills run in a sandbox whose image is still being prepared — retry shortly.';
  }
  return 'Skills run in a sandbox, which is not configured.';
}

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    // Sandbox is usable only when a provider is configured AND its image build reports ready.
    // Refresh the persisted status (and re-activate an idle snapshot); fail closed (disabled) if it throws.
    let status: SandboxBuildStatus | undefined;
    try {
      const refreshed = await checkSnapshotStatus({
        store: deps.sandboxProviderStore,
        tenant_id: TENANT_ID,
        logger: deps.logger,
      });
      status = refreshed?.status;
    } catch (error) {
      deps.logger.warn('Sandbox image status check failed; reporting sandbox disabled', extractErrorLogFields(error));
    }
    const sandboxEnabled = status === 'ready' || (status === undefined && isLocalSandboxFallbackEnabled());
    const settingsEnabled = isAdmin(resolveUserContext(c));
    return c.json(
      {
        data: {
          sandbox: { enabled: sandboxEnabled },
          skill: sandboxEnabled ? { enabled: true } : { enabled: false, reason: skillDisabledReason(status) },
          settings: { enabled: settingsEnabled },
        },
      },
      200,
    );
  });
  return router;
}
