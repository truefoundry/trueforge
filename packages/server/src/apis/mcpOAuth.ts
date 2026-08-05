import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  completeMcpAuthorization,
  extractErrorLogFields,
  McpConnectionError,
  type IOAuthClientStore,
  type IOAuthTokenStore,
} from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import { mcpOAuthCallbackRoute } from '../routes/mcpOAuthRoutes';

export interface McpOAuthRouterDeps {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  logger: Logger;
}

type McpOAuthCallbackContext = Parameters<RouteHandler<typeof mcpOAuthCallbackRoute>>[0];

/** FE landing URL from the authorize call, with the outcome appended to its existing query params. */
function callbackLandingUrl(redirectUrl: string, reason?: string): string {
  const url = new URL(redirectUrl);
  if (reason === undefined) {
    url.searchParams.set('isSuccess', 'true');
    return url.href;
  }
  url.searchParams.set('isSuccess', 'false');
  url.searchParams.set('reason', reason);
  return url.href;
}

/**
 * Send the browser back to the FE with the reason. JSON is only for callbacks with no landing URL to
 * return to — authorize was called without `redirect_url`, or the pending row is already gone.
 */
function callbackFailure(
  c: McpOAuthCallbackContext,
  redirectUrl: string | null | undefined,
  message: string,
  jsonStatus: 400 | 500 = 400,
) {
  if (redirectUrl) {
    return c.redirect(callbackLandingUrl(redirectUrl, message), 302);
  }
  return c.json({ error: { message } }, jsonStatus);
}

/** Shared OAuth callback (mounted at /api/v1/mcp-servers/oauth). */
export function createMcpOAuthRouter(deps: McpOAuthRouterDeps) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = async c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    // Claimed up front: this row carries the FE landing URL every branch below redirects to, and
    // claiming it atomically means a duplicate callback loses the race.
    const pending = await deps.tokenStore.consumePendingAuthorization({ state });

    if (error) {
      deps.logger.warn('MCP OAuth callback returned an error', { state, error, errorDescription });
      return callbackFailure(c, pending?.redirectUrl, error);
    }

    if (!code) {
      return callbackFailure(c, pending?.redirectUrl, 'OAuth callback is missing both `code` and `error`');
    }

    if (!pending) {
      return callbackFailure(c, undefined, 'Unknown or expired OAuth state');
    }

    try {
      await completeMcpAuthorization({
        tokenStore: deps.tokenStore,
        mcpServerStore: deps.mcpServerStore,
        pending,
        code,
      });
    } catch (err) {
      // Only a known MCP failure is safe to show the user; anything else gets a generic reason.
      if (err instanceof McpConnectionError) {
        deps.logger.warn('MCP OAuth callback token exchange failed', extractErrorLogFields(err));
        return callbackFailure(c, pending.redirectUrl, err.message);
      }
      deps.logger.error('MCP OAuth callback unexpected failure', extractErrorLogFields(err));
      return callbackFailure(c, pending.redirectUrl, 'Internal server error', 500);
    }

    if (pending.redirectUrl) {
      return c.redirect(callbackLandingUrl(pending.redirectUrl), 302);
    }
    return c.json({ success: true as const }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(mcpOAuthCallbackRoute, callbackHandler);
  return router;
}
