import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import { mcpOAuthCallbackRoute } from '../routes/legacyMcpOAuthRoutes';

export interface LegacyMcpOAuthRouterDeps {
  logger: Logger;
}

// STUB: fix this.
const STUB_CONNECTED_REDIRECT = '/mcp/oauth/connected';
const STUB_FAILED_REDIRECT = '/mcp/oauth/failed';

export function createLegacyMcpOAuthRouter(deps: LegacyMcpOAuthRouterDeps) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    if (error) {
      deps.logger.warn('MCP OAuth callback returned an error', { state, error, errorDescription });
      return c.redirect(STUB_FAILED_REDIRECT, 302);
    }

    if (!code) {
      return c.json({ error: { message: 'OAuth callback is missing both `code` and `error`' } }, 400);
    }

    // STUB: real implementation exchanges `code` for a token here; no lookup/exchange happens yet.
    deps.logger.info('MCP OAuth callback received (stub — no token exchange performed)', { state });
    return c.redirect(STUB_CONNECTED_REDIRECT, 302);
  };

  const router = new OpenAPIHono();
  router.openapi(mcpOAuthCallbackRoute, callbackHandler);
  return router;
}
