import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  completeMcpAuthorization,
  extractErrorLogFields,
  McpConnectionError,
  type IOAuthClientStore,
  type IOAuthTokenStore,
} from '@truefoundry/utils/core';
import type { Logger } from 'winston';
import { mcpOAuthCallbackRoute } from '../routes/mcpOAuthRoutes';

export interface McpOAuthRouterDeps {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  logger: Logger;
}

/** Fallback when pending auth had no FE `redirect_url` (should not happen for settings authorize). */
const DEFAULT_CONNECTED_REDIRECT = '/mcp/oauth/connected';
const DEFAULT_FAILED_REDIRECT = '/mcp/oauth/failed';

/** Shared OAuth callback (mounted at /api/v1/mcp-servers/oauth). */
export function createMcpOAuthRouter(deps: McpOAuthRouterDeps) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = async c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    if (error) {
      deps.logger.warn('MCP OAuth callback returned an error', { state, error, errorDescription });
      return c.redirect(DEFAULT_FAILED_REDIRECT, 302);
    }

    if (!code) {
      return c.json({ error: { message: 'OAuth callback is missing both `code` and `error`' } }, 400);
    }

    try {
      const result = await completeMcpAuthorization({
        tokenStore: deps.tokenStore,
        mcpServerStore: deps.mcpServerStore,
        state,
        code,
      });
      return c.redirect(result.redirectUrl ?? DEFAULT_CONNECTED_REDIRECT, 302);
    } catch (err) {
      if (err instanceof McpConnectionError) {
        deps.logger.warn('MCP OAuth callback token exchange failed', extractErrorLogFields(err));
        return c.json({ error: { message: err.message } }, 400);
      }
      throw err;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(mcpOAuthCallbackRoute, callbackHandler);
  return router;
}
