/**
 * Auth route definitions (mounted at /api/v1/auth). Handlers in apis/auth.ts.
 *
 * `login`/`callback` are browser-redirect targets, never called by SDK
 * consumers — both carry `x-fern-ignore`, the same convention used for the
 * MCP OAuth callback in mcpOAuthRoutes.ts. `me`/`logout` are real JSON
 * endpoints and generate normally.
 */
import { createRoute } from '@hono/zod-openapi';
import { AuthLoginQuerySchema, AuthMeResponseSchema, OAuthCallbackQuerySchema } from '../schemas/auth';
import { RequestErrorResponseSchema } from '../schemas/errors';

const AUTH_TAG = 'Auth';

export const authLoginRoute = createRoute({
  method: 'get',
  path: '/login',
  tags: [AUTH_TAG],
  summary: 'Start the login flow',
  description:
    'Redirects the browser to the configured identity provider. In local/single-binary mode, redirects straight ' +
    'back into the app — there is nothing to log into.',
  'x-fern-ignore': true,
  request: { query: AuthLoginQuerySchema },
  responses: {
    302: { description: 'Redirect to the IdP authorization endpoint.' },
  },
});

export const oAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: [AUTH_TAG],
  summary: 'Login callback',
  description:
    'Browser-redirect target hit by the identity provider after login, never called directly by SDK consumers. ' +
    'In local/single-binary mode, redirects straight back into the app.',
  'x-fern-ignore': true,
  request: { query: OAuthCallbackQuerySchema },
  responses: {
    302: { description: 'Redirect back into the app on success, or to /login?error=... on failure.' },
  },
});

export const authLogoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: [AUTH_TAG],
  summary: 'Clear the local session',
  description:
    'Ends the local harness session only — does not hit the IdP end-session endpoint. A no-op in local/single-binary ' +
    'mode, since there is no real session to clear.',
  'x-fern-sdk-group-name': ['auth'],
  'x-fern-sdk-method-name': 'logout',
  responses: {
    204: { description: 'Session cookie cleared.' },
  },
});

export const authMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: [AUTH_TAG],
  summary: 'Get the current identity',
  description:
    "Returns the fixed local identity in local/single-binary mode; otherwise the caller's verified identity.",
  'x-fern-sdk-group-name': ['auth'],
  'x-fern-sdk-method-name': 'me',
  responses: {
    200: {
      content: { 'application/json': { schema: AuthMeResponseSchema } },
      description: "The caller's identity.",
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not authenticated.',
    },
  },
});
