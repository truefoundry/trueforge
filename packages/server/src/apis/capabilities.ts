import { OpenAPIHono } from '@hono/zod-openapi';
import { extractErrorLogFields } from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import { isAdmin, resolveUserContext } from '../auth/identity';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { sandboxImageStatus } from '../sandbox/providerUtils';
import { TENANT_ID } from './sessions';

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    // Sandbox is usable only when a provider is configured AND its image build reports ready.
    // Read live from the provider; fail closed (disabled) if Daytona is unreachable/creds are bad.
    let sandboxEnabled = false;
    try {
      const build = await sandboxImageStatus({
        store: deps.sandboxProviderStore,
        tenant_id: TENANT_ID,
        logger: deps.logger,
      });
      // build === undefined means no provider configured — leave disabled, never treat as ready.
      if (build) {
        sandboxEnabled = build.status === 'ready';
      }
    } catch (error) {
      deps.logger.warn('Sandbox image status check failed; reporting sandbox disabled', extractErrorLogFields(error));
    }
    const settingsEnabled = isAdmin(resolveUserContext(c));
    return c.json(
      {
        data: {
          sandbox: { enabled: sandboxEnabled },
          skill: sandboxEnabled
            ? { enabled: true }
            : {
                enabled: false,
                reason: 'Skills run in a sandbox, which is not configured.',
              },
          settings: { enabled: settingsEnabled },
        },
      },
      200,
    );
  });
  return router;
}
