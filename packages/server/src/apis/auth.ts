import { OpenAPIHono } from '@hono/zod-openapi';
import { LOCAL_USER, LOGIN_ERROR_PATH } from '../auth/constants';
import {
  clearIdTokenCookie,
  clearOAuthStateCookie,
  readIdTokenCookie,
  readOAuthStateCookie,
  setIdTokenCookie,
  setOAuthStateCookie,
} from '../auth/cookies';
import {
  buildLoginAuthorization,
  exchangeAuthorizationCode,
  identityFromIdToken,
  oidcConfig,
  safeReturnTo,
} from '../auth/oidc';
import configuration, { isOidcConfigured } from '../config';
import {
  authConfigRoute,
  authLoginRoute,
  authLogoutRoute,
  authMeRoute,
  oAuthCallbackRoute,
} from '../routes/authRoutes';

export function createAuthRouter() {
  const router = new OpenAPIHono();

  router.openapi(authConfigRoute, c => {
    return c.json({ oidc_enabled: isOidcConfigured() }, 200);
  });

  router.openapi(authLoginRoute, async c => {
    const oidc = oidcConfig();
    if (!oidc) {
      return c.redirect('/', 302);
    }

    try {
      const { authorizationUrl, state, codeVerifier } = await buildLoginAuthorization();
      setOAuthStateCookie(c, {
        state,
        code_verifier: codeVerifier,
        return_to: safeReturnTo(c.req.valid('query').return_to),
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
    clearOAuthStateCookie(c);

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
      const requestUrl = new URL(c.req.url);
      const callbackUrl = new URL(requestUrl.pathname + requestUrl.search, configuration.PUBLIC_BASE_URL);
      const { idToken, expiresAtSeconds } = await exchangeAuthorizationCode({
        callbackUrl,
        codeVerifier: pending.code_verifier,
        expectedState: pending.state,
      });
      const maxAge = Math.max(0, expiresAtSeconds - Math.floor(Date.now() / 1000));
      setIdTokenCookie(c, idToken, maxAge);
      return c.redirect(safeReturnTo(pending.return_to), 302);
    } catch {
      return c.redirect(LOGIN_ERROR_PATH, 302);
    }
  });

  router.openapi(authLogoutRoute, c => {
    clearIdTokenCookie(c);
    return c.body(null, 204);
  });

  router.openapi(authMeRoute, async c => {
    const oidc = oidcConfig();
    if (!oidc) {
      return c.json(LOCAL_USER, 200);
    }

    const idToken = readIdTokenCookie(c);
    if (!idToken) {
      return c.json({ error: { message: 'Not authenticated' } }, 401);
    }

    try {
      const identity = await identityFromIdToken({ oidc, idToken });
      return c.json(identity, 200);
    } catch {
      return c.json({ error: { message: 'Not authenticated' } }, 401);
    }
  });

  return router;
}
