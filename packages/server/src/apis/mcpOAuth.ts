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

/** Shared OAuth callback (mounted at /api/v1/mcp-servers/oauth). */
export function createMcpOAuthRouter(deps: McpOAuthRouterDeps) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = async c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    if (error) {
      deps.logger.warn('MCP OAuth callback returned an error', { state, error, errorDescription });
      await deps.tokenStore.consumePendingAuthorization({ state });
      return c.json({ error: { message: errorDescription ? `${error}: ${errorDescription}` : error } }, 400);
    }

    if (!code) {
      return c.json({ error: { message: 'OAuth callback is missing both `code` and `error`' } }, 400);
    }

    try {
      await completeMcpAuthorization({
        tokenStore: deps.tokenStore,
        mcpServerStore: deps.mcpServerStore,
        state,
        code,
      });
      return c.json({ success: true as const }, 200);
    } catch (err) {
      if (err instanceof McpConnectionError) {
        deps.logger.warn('MCP OAuth callback token exchange failed', extractErrorLogFields(err));
        return c.json({ error: { message: err.message } }, 400);
      }
      deps.logger.error('MCP OAuth callback unexpected failure', extractErrorLogFields(err));
      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };

  const router = new OpenAPIHono();
  router.openapi(mcpOAuthCallbackRoute, callbackHandler);
  return router;
}
