import { OpenAPIHono } from '@hono/zod-openapi';
import { isAdmin, resolveUserContext } from '../auth/identity';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { TENANT_ID } from './sessions';

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    const sandboxEnabled = record !== undefined;
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
