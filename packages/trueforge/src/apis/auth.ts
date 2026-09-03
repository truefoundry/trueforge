import { OpenAPIHono } from '@hono/zod-openapi';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { Context, MiddlewareHandler } from 'hono';
import type { Configuration } from 'openid-client';
import type { Logger } from 'winston';
import { clearAuthCookie, ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, readOAuthStateCookie } from '../auth/cookies';
import { resolveRequestContext } from '../auth/identity';
import { resolveOidcRequestContext } from '../auth/middleware';
import { buildLoginAuthorization, exchangeAuthorizationCode } from '../auth/oidc';
import { safeReturnTo } from '../auth/safeReturnTo';
import { authLoginRoute, authLogoutRoute, meRoute, oAuthCallbackRoute } from '../routes/authRoutes';
import type { GetMeResponse } from '../schemas/auth';

/** Login / OIDC failures land on `/?error=<reason>`. */
function oauthErrorRedirect(reason: string): string {
  return `/?error=${encodeURIComponent(reason)}`;
}

/**
 * Soft-success probe for callback: a usable session → redirect; a leftover cookie
 * with unusable claims (allowlist, missing user ref, etc.) → clear it and continue
 * so the caller can show a generic login failure without leaking why.
 */
async function redirectIfAlreadyAuthenticated(params: {
  context: Context;
  whenAuthenticated: string;
}): Promise<Response | undefined> {
  try {
    if (await resolveOidcRequestContext(params.context)) {
      return params.context.redirect(params.whenAuthenticated, 302);
    }
  } catch {
    // Valid JWT but unusable claims — drop the stale cookie; treat as unauthenticated.
    clearAuthCookie({ context: params.context, name: ID_TOKEN_COOKIE });
  }
  return undefined;
}

/**
 * Auth surfaces mounted at /api/v1/auth: login, callback, logout, me.
 * Login, callback, and logout stay public; me requires the injected {@link authMiddleware}.
 */
export function createAuthRouter(params: {
  oidcClient: Configuration | undefined;
  logger: Logger;
  authMiddleware: MiddlewareHandler;
}) {
  const router = new OpenAPIHono();

  router.openapi(authLoginRoute, async c => {
    // TODO: remove this checks once the middleware is implemented
    if (!params.oidcClient) {
      return c.redirect('/', 302);
    }

    try {
      const authorizationUrl = await buildLoginAuthorization({
        context: c,
        client: params.oidcClient,
        returnTo: c.req.valid('query').return_to,
      });
      return c.redirect(authorizationUrl, 302);
    } catch (error) {
      params.logger.error('Failed to build login authorization', extractErrorLogFields(error));
      return c.redirect(oauthErrorRedirect('login_failed'), 302);
    }
  });

  router.openapi(oAuthCallbackRoute, async c => {
    if (!params.oidcClient) {
      return c.redirect('/', 302);
    }

    const query = c.req.valid('query');
    const pending = readOAuthStateCookie({ context: c, logger: params.logger });
    clearAuthCookie({ context: c, name: OAUTH_STATE_COOKIE });

    if (pending?.state !== query.state || query.error || !query.code) {
      // If already authenticated, redirect home instead of showing an error.
      const soft = await redirectIfAlreadyAuthenticated({ context: c, whenAuthenticated: '/' });
      if (soft) {
        return soft;
      }
      // Only reflect a non-empty IdP `error_description` when the IdP returned an error.
      // No fallback to the `error` code — blank/missing descriptions use the default.
      // Our own validation failures (state mismatch / missing code) stay generic too.
      const description = query.error_description?.trim();
      const reason = query.error && description ? description : 'login_failed';
      return c.redirect(oauthErrorRedirect(reason), 302);
    }

    try {
      await exchangeAuthorizationCode({
        context: c,
        client: params.oidcClient,
        callbackParams: new URL(c.req.url).searchParams,
        codeVerifier: pending.code_verifier,
        state: pending.state,
      });
      return c.redirect(safeReturnTo(pending.return_to), 302);
    } catch (error) {
      params.logger.error('Failed to exchange authorization code', extractErrorLogFields(error));
      const soft = await redirectIfAlreadyAuthenticated({
        context: c,
        whenAuthenticated: safeReturnTo(pending.return_to),
      });
      if (soft) {
        return soft;
      }
      const reason = error instanceof Error ? error.message : 'login_failed';
      return c.redirect(oauthErrorRedirect(reason), 302);
    }
  });

  router.openapi(authLogoutRoute, c => {
    // Cookie deletion is idempotent, so logout also succeeds when no cookie exists.
    clearAuthCookie({ context: c, name: ID_TOKEN_COOKIE });
    return c.body(null, 204);
  });

  const gated = new OpenAPIHono();
  gated.use('*', params.authMiddleware);
  gated.openapi(meRoute, c => {
    const requestContext = resolveRequestContext(c);
    const body: GetMeResponse = {
      tenant_id: requestContext.tenant_id,
      subject: requestContext.subject,
      is_admin: requestContext.is_admin,
    };
    return c.json(body, 200);
  });
  router.route('/', gated);

  return router;
}
