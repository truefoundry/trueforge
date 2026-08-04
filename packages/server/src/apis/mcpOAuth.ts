import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  completeMcpAuthorization,
  extractErrorLogFields,
  McpConnectionError,
  validateRedirectUris,
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
      const pending = await deps.tokenStore.consumePendingAuthorization({ state });
      if (pending?.redirectUrl) {
        // TODO(mcp-oauth): pass allowList once we have a configured FE redirect allowlist (open-redirect guard).
        validateRedirectUris({ redirectUris: [pending.redirectUrl] });
        const url = new URL(pending.redirectUrl);
        url.searchParams.set('error', error);
        if (errorDescription) {
          url.searchParams.set('error_description', errorDescription);
        }
        return c.redirect(url.toString(), 302);
      }
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
      if (result.redirectUrl) {
        // TODO(mcp-oauth): pass allowList once we have a configured FE redirect allowlist (open-redirect guard).
        validateRedirectUris({ redirectUris: [result.redirectUrl] });
        return c.redirect(result.redirectUrl, 302);
      }
      return c.redirect(DEFAULT_CONNECTED_REDIRECT, 302);
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
