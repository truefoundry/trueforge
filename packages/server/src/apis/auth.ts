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

  if (!isOidcConfigured()) {
    router.openapi(authMeRoute, c => c.json(LOCAL_USER, 200));
    return router;
  }

  // TODO: Implement the actual auth routes.
  router.openapi(authLoginRoute, c => c.redirect('/', 302));
  router.openapi(authLogoutRoute, c => c.body(null, 204));
  router.openapi(authMeRoute, c => c.json({ error: { message: 'Not authenticated' } }, 401));
  router.openapi(oAuthCallbackRoute, c => c.redirect('/', 302));

  return router;
}
