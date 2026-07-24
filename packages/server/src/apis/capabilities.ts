import { OpenAPIHono } from '@hono/zod-openapi';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';

export function createCapabilitiesRouter(deps: { sandboxEnabled: boolean }) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, c =>
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
