/**
 * Auth API (mounted at /api/v1/auth).
 *
 * For the no-identity-provider (local/single-binary) case,
 * `/me` always succeeds with a fixed local identity.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { isOidcConfigured } from '../config';
import { authLoginRoute, authLogoutRoute, authMeRoute, oAuthCallbackRoute } from '../routes/authRoutes';
import type { AuthMeResponse } from '../schemas/auth';

/** Fixed identity used when no identity provider is configured. */
const LOCAL_USER: AuthMeResponse = {
  user_ref: 'trueforge-default',
  role: 'admin',
};

export function createAuthRouter() {
  const router = new OpenAPIHono();

  router.openapi(authLoginRoute, c => {
    if (!isOidcConfigured()) {
      return c.redirect('/', 302);
    }
    // TODO: Implement the actual login redirect to the identity provider.
    return c.redirect('/', 302);
  });

  router.openapi(oAuthCallbackRoute, c => {
    if (!isOidcConfigured()) {
      return c.redirect('/', 302);
    }
    // TODO: Implement the actual OIDC callback (code exchange, session cookie).
    return c.redirect('/', 302);
  });

  router.openapi(authLogoutRoute, c => {
    // No real session in either mode yet — always a no-op.
    return c.body(null, 204);
  });

  router.openapi(authMeRoute, c => {
    if (!isOidcConfigured()) {
      return c.json(LOCAL_USER, 200);
    }
    // TODO: Resolve the caller's verified identity from their session cookie.
    return c.json({ error: { message: 'Not authenticated' } }, 401);
  });

  return router;
}
