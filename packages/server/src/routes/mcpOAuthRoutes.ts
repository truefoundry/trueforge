import { createRoute } from '@hono/zod-openapi';
import { OAuthCallbackQuerySchema, OAuthCallbackSuccessSchema } from '../schemas/auth';
import { RequestErrorResponseSchema } from '../schemas/errors';

const MCP_OAUTH_TAG = 'MCP OAuth';

export const mcpOAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: [MCP_OAUTH_TAG],
  summary: 'OAuth callback for MCP authorization',
  // Browser-redirect target hit directly by the authorization server, never called by SDK.
  'x-fern-ignore': true,
  request: {
    query: OAuthCallbackQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: OAuthCallbackSuccessSchema } },
      description: 'Token exchanged successfully and no `redirect_url` was given at authorize time.',
    },
    302: {
      description:
        'Redirect to the `redirect_url` given at authorize time, with `isSuccess` (and `reason` when it failed) appended to its existing query params.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'IdP `error`, unknown/expired `state`, token exchange failure, or `code`/`error` both missing.',
    },
    500: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unexpected failure during token exchange.',
    },
  },
});
