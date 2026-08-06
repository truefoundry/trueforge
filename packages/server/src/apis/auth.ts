import { OpenAPIHono } from '@hono/zod-openapi';
import { clearAuthCookie, ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, readOAuthStateCookie } from '../auth/cookies';
import { buildLoginAuthorization, exchangeAuthorizationCode, safeReturnTo } from '../auth/oidc';
import { oidcConfig } from '../config';
import { authLoginRoute, authLogoutRoute, oAuthCallbackRoute } from '../routes/authRoutes';

const LOGIN_ERROR_PATH = '/?error=login_failed';

export function createAuthRouter() {
  const router = new OpenAPIHono();

  router.openapi(authLoginRoute, async c => {
    const oidc = oidcConfig();
    if (!oidc) {
      return c.redirect('/', 302);
    }

    try {
      const authorizationUrl = await buildLoginAuthorization({
        context: c,
        oidc,
        returnTo: c.req.valid('query').return_to,
      });
      return c.redirect(authorizationUrl, 302);
    } catch {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
  });

  router.openapi(oAuthCallbackRoute, async c => {
    const oidc = oidcConfig();
    if (!oidc) {
      return c.redirect('/', 302);
    }

    const query = c.req.valid('query');
    const pending = readOAuthStateCookie(c);
    clearAuthCookie({ context: c, name: OAUTH_STATE_COOKIE });

    if (!pending) {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
    if (pending.state !== query.state) {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
    if (query.error || !query.code) {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }

    try {
      await exchangeAuthorizationCode({
        context: c,
        oidc,
        callbackParams: new URL(c.req.url).searchParams,
        codeVerifier: pending.code_verifier,
        expectedState: pending.state,
      });
      return c.redirect(safeReturnTo(pending.return_to), 302);
    } catch {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
  });

  router.openapi(authLogoutRoute, c => {
    // Cookie deletion is idempotent, so logout also succeeds when no cookie exists.
    clearAuthCookie({ context: c, name: ID_TOKEN_COOKIE });
    return c.body(null, 204);
  });

  return router;
}
