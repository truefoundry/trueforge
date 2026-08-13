import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { extractErrorLogFields, McpConnectionError } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { WithTransaction } from '../db/transaction';
import { completeMcpAuthorization } from '../mcp/auth/mcpDcr';
import type { IOAuthClientStore, IOAuthTokenStore, OAuthPendingAuthorization } from '../mcp/auth/types';
import { mcpOAuthCallbackRoute } from '../routes/mcpOAuthRoutes';

export interface McpOAuthRouterDeps<TTransaction> {
  tokenStore: IOAuthTokenStore<TTransaction>;
  mcpServerStore: IOAuthClientStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}

type McpOAuthCallbackContext = Parameters<RouteHandler<typeof mcpOAuthCallbackRoute>>[0];

/** Landing URL with the outcome appended to whatever query params it already carries. */
function callbackLandingUrl(params: { redirectUrl: string; isSuccess: boolean; reason?: string }): string {
  const url = new URL(params.redirectUrl);
  url.searchParams.set('isSuccess', String(params.isSuccess));
  if (params.reason) {
    url.searchParams.set('reason', params.reason);
  }
  return url.href;
}

/**
 * JSON is the answer whenever there is no landing URL to return to: authorize was called without
 * `redirect_url`, or the pending row that carried it is gone (TTL expired, already redeemed, unknown
 * `state`) — the OAuth callback URL is never a page we send the user to on purpose.
 */
function callbackSuccess(params: { c: McpOAuthCallbackContext; pending: OAuthPendingAuthorization }) {
  const redirectUrl = params.pending.redirectUrl;
  if (redirectUrl) {
    return params.c.redirect(callbackLandingUrl({ redirectUrl, isSuccess: true }), 302);
  }
  return params.c.json({ success: true as const }, 200);
}

function callbackFailure(params: {
  c: McpOAuthCallbackContext;
  pending: OAuthPendingAuthorization | undefined;
  message: string;
  jsonStatus?: 400 | 500;
}) {
  const redirectUrl = params.pending?.redirectUrl;
  if (redirectUrl) {
    return params.c.redirect(callbackLandingUrl({ redirectUrl, isSuccess: false, reason: params.message }), 302);
  }
  return params.c.json({ error: { message: params.message } }, params.jsonStatus ?? 400);
}

/** Shared OAuth callback (mounted at /api/v1/mcp-servers/oauth). */
export function createMcpOAuthRouter<TTransaction>(deps: McpOAuthRouterDeps<TTransaction>) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = async c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    // Claimed up front: this row carries the FE landing URL every branch below returns to, and
    // claiming it atomically means a duplicate callback loses the race.
    const pending = await deps.tokenStore.consumePendingAuthorization({ state });
    if (!pending) {
      deps.logger.warn('MCP OAuth callback has no pending authorization', { state, error, errorDescription });
      return callbackFailure({ c, pending, message: 'Unknown or expired OAuth state' });
    }

    if (error) {
      deps.logger.warn('MCP OAuth callback returned an error', { state, error, errorDescription });
      return callbackFailure({ c, pending, message: error });
    }

    if (!code) {
      return callbackFailure({ c, pending, message: 'OAuth callback is missing both `code` and `error`' });
    }

    try {
      await completeMcpAuthorization({
        tokenStore: deps.tokenStore,
        mcpServerStore: deps.mcpServerStore,
        withTransaction: deps.withTransaction,
        pending,
        code,
      });
    } catch (err) {
      // Only a known MCP failure is safe to show the user; anything else gets a generic reason.
      if (err instanceof McpConnectionError) {
        deps.logger.warn('MCP OAuth callback token exchange failed', extractErrorLogFields(err));
        return callbackFailure({ c, pending, message: err.message });
      }
      deps.logger.error('MCP OAuth callback unexpected failure', extractErrorLogFields(err));
      return callbackFailure({ c, pending, message: 'Internal server error', jsonStatus: 500 });
    }

    return callbackSuccess({ c, pending });
  };

  const router = new OpenAPIHono();
  router.openapi(mcpOAuthCallbackRoute, callbackHandler);
  return router;
}
