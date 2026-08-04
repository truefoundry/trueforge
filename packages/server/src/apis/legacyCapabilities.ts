import { OpenAPIHono } from '@hono/zod-openapi';
import { getLegacyCapabilitiesRoute } from '../routes/legacyCapabilityRoutes';

/** Legacy capabilities (mounted at /api/v1/legacy/capabilities). */
export function createLegacyCapabilitiesRouter(deps: { sandboxEnabled: boolean }) {
  const router = new OpenAPIHono();
  router.openapi(getLegacyCapabilitiesRoute, c =>
    c.json(
      {
        data: {
          sandbox: { enabled: deps.sandboxEnabled },
        },
      },
      200,
    ),
  );
  return router;
}
