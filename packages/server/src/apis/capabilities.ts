import { OpenAPIHono } from '@hono/zod-openapi';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { TENANT_ID } from './sessions';

export function createCapabilitiesRouter(deps: { sandboxProviderStore: ISandboxProviderStore }) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    const sandboxEnabled = record !== undefined;
    return c.json(
      {
        data: {
          sandbox: { enabled: sandboxEnabled },
          skill: { enabled: sandboxEnabled },
          settings: { enabled: true },
        },
      },
      200,
    );
  });
  return router;
}
