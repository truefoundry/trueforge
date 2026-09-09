/**
 * Auth route definitions (mounted at /api/v1/auth). Handlers in apis/auth.ts.
 *
 * `login`/`callback`/`logout` are browser-session helpers, never called by SDK
 * consumers — they carry `x-fern-ignore`, the same convention used for the
 * MCP OAuth callback in mcpOAuthRoutes.ts. `me` generates normally.
 */
import { createRoute } from '@hono/zod-openapi';
import { AuthLoginQuerySchema, GetMeResponseSchema, OAuthCallbackQuerySchema } from '../schemas/auth';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const authLoginRoute = createRoute({
  method: 'get',
  path: '/login',
  tags: [OpenApiTag.AUTH],
  summary: 'Start the login flow',
  description:
    'Redirects the browser to the configured identity provider. In local/single-binary mode, redirects straight ' +
    'back into the app — there is nothing to log into.',
  'x-fern-ignore': true,
  'x-excluded': true,
  request: { query: AuthLoginQuerySchema },
  responses: {
    302: { description: 'Redirect to the IdP authorization endpoint.' },
  },
});

export const oAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: [OpenApiTag.AUTH],
  summary: 'Login callback',
  description:
    'Browser-redirect target hit by the identity provider after login, never called directly by SDK consumers. ' +
    'In local/single-binary mode, redirects straight back into the app.',
  'x-fern-ignore': true,
  'x-excluded': true,
  request: { query: OAuthCallbackQuerySchema },
  responses: {
    302: { description: 'Redirect back into the app on success, or to /?error=<reason> on failure.' },
  },
});

export const authLogoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: [OpenApiTag.AUTH],
  summary: 'Clear the local session',
  description:
    'Ends the local harness session only — does not hit the IdP end-session endpoint. A no-op in local/single-binary ' +
    'mode, since there is no real session to clear.',
  'x-fern-ignore': true,
  'x-excluded': true,
  responses: {
    204: { description: 'Session cookie cleared.' },
  },
});

export const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: [OpenApiTag.AUTH],
  summary: 'Current session',
  description:
    'Returns the authenticated caller identity (`type`, `tenant_id`, `subject`, `roles`) wrapped as `{ data }`. ' +
    '`type` is `oidc-connected` when browser OIDC is enabled, otherwise `default`. When auth is enabled ' +
    'this requires a valid `id_token` cookie or `Authorization: Bearer` token (401 otherwise). When auth is ' +
    'disabled, returns the standalone default identity.',
  'x-fern-sdk-group-name': ['auth'],
  'x-fern-sdk-method-name': 'me',
  responses: {
    200: {
      content: { 'application/json': { schema: GetMeResponseSchema } },
      description: 'Caller identity for the current request.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Auth is enabled and the request has no valid cookie or Bearer token.',
    },
  },
});
