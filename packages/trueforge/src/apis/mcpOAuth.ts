import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { extractErrorLogFields, McpConnectionError } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import { completeMcpAuthorization } from '../mcp/auth/mcpDcr';
import type { IOAuthClientStore, IOAuthTokenStore, OAuthPendingAuthorization } from '../mcp/auth/types';
import { mcpOAuthCallbackRoute } from '../routes/mcpOAuthRoutes';

export interface McpOAuthRouterDeps<TTransaction> {
  tokenStore: IOAuthTokenStore<TTransaction>;
  mcpServerStore: IOAuthClientStore<TTransaction>;
  logger: Logger;
}

type McpOAuthCallbackContext = Parameters<RouteHandler<typeof mcpOAuthCallbackRoute>>[0];

/**
 * Landing path with the outcome appended to whatever query params it already carries.
 * `returnTo` is resolved against the callback request URL only so `URL` can parse the
 * relative path; the redirect stays relative (`pathname + search`), so the browser
 * keeps whatever origin it is already on.
 */
function callbackLandingPath(params: {
  c: McpOAuthCallbackContext;
  returnTo: string;
  isSuccess: boolean;
  reason?: string;
}): string {
  const url = new URL(params.returnTo, params.c.req.url);
  url.searchParams.set('isSuccess', String(params.isSuccess));
  if (params.reason) {
    url.searchParams.set('reason', params.reason);
  }
  return `${url.pathname}${url.search}`;
}

/**
 * JSON is the answer whenever there is no landing path to return to: authorize was called without
 * `return_to`, or the pending row that carried it is gone (TTL expired, already redeemed, unknown
 * `state`) — the OAuth callback URL is never a page we send the user to on purpose.
 */
function callbackSuccess(params: { c: McpOAuthCallbackContext; pending: OAuthPendingAuthorization }) {
  const returnTo = params.pending.returnTo;
  if (returnTo) {
    return params.c.redirect(callbackLandingPath({ c: params.c, returnTo, isSuccess: true }), 302);
  }
  return params.c.json({ success: true as const }, 200);
}

function callbackFailure(params: {
  c: McpOAuthCallbackContext;
  pending: OAuthPendingAuthorization | undefined;
  message: string;
  jsonStatus?: 400 | 500;
}) {
  const returnTo = params.pending?.returnTo;
  if (returnTo) {
    return params.c.redirect(
      callbackLandingPath({ c: params.c, returnTo, isSuccess: false, reason: params.message }),
      302,
    );
  }
  return params.c.json({ error: { message: params.message } }, params.jsonStatus ?? 400);
}

/** Shared OAuth callback (mounted at /api/v1/mcp-servers/oauth). */
export function createMcpOAuthRouter<TTransaction>(deps: McpOAuthRouterDeps<TTransaction>) {
  const callbackHandler: RouteHandler<typeof mcpOAuthCallbackRoute> = async c => {
    const { state, code, error, error_description: errorDescription } = c.req.valid('query');

    // Claimed up front: this row carries the FE landing path every branch below returns to, and
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
