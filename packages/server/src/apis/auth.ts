import { OpenAPIHono } from '@hono/zod-openapi';
import { getCookie } from 'hono/cookie';
import type { Configuration } from 'openid-client';
import type { Logger } from 'winston';
import { clearAuthCookie, ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, readOAuthStateCookie } from '../auth/cookies';
import { buildLoginAuthorization, exchangeAuthorizationCode, safeReturnTo } from '../auth/oidc';
import { authLoginRoute, authLogoutRoute, meRoute, oAuthCallbackRoute } from '../routes/authRoutes';

const LOGIN_ERROR_PATH = '/?error=login_failed';

/**
 * Public auth surfaces: `/auth/*` (login/callback/logout) and `/me`.
 * Mount at `/api/v1` so paths resolve to `/api/v1/auth/...` and `/api/v1/me`.
 */
export function createAuthRouter(params: { oidcClient: Configuration | undefined; logger: Logger }) {
  const router = new OpenAPIHono();
  const auth = new OpenAPIHono();

  auth.openapi(authLoginRoute, async c => {
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
      params.logger.error('Failed to build login authorization', {
        error: error instanceof Error ? error.message : error,
      });
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
  });

  auth.openapi(oAuthCallbackRoute, async c => {
    if (!params.oidcClient) {
      return c.redirect('/', 302);
    }

    const query = c.req.valid('query');
    const pending = readOAuthStateCookie({ context: c, logger: params.logger });
    clearAuthCookie({ context: c, name: OAUTH_STATE_COOKIE });

    if (pending?.state !== query.state || query.error || !query.code) {
      // TODO: handle the error here once frontend error page is implemented
      return c.redirect(LOGIN_ERROR_PATH, 302);
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
      params.logger.error('Failed to exchange authorization code', {
        error: error instanceof Error ? error.message : error,
      });
      // TODO: handle the error here once frontend error page is implemented
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
  });

  auth.openapi(authLogoutRoute, c => {
    // Cookie deletion is idempotent, so logout also succeeds when no cookie exists.
    clearAuthCookie({ context: c, name: ID_TOKEN_COOKIE });
    return c.body(null, 204);
  });

  router.route('/auth', auth);

  router.openapi(meRoute, c => {
    const token = getCookie(c, ID_TOKEN_COOKIE);
    if (token) {
      return c.json({ type: 'passport' }, 200);
    }
    return c.json({ type: 'default' }, 200);
  });

  return router;
}
