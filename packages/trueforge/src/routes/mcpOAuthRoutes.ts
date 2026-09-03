import { createRoute } from '@hono/zod-openapi';
import { OAuthCallbackQuerySchema, OAuthCallbackSuccessSchema } from '../schemas/auth';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const mcpOAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'OAuth callback for MCP authorization',
  description:
    'Browser redirect target for MCP server OAuth. The authorization server redirects here with `code`/`state` (or `error`). ' +
    'Exchanges the code for tokens, then either returns JSON or redirects to the `return_to` path supplied at authorize time. ' +
    'Not called by the SDK — browsers hit this URL directly.',
  // Browser-redirect target hit directly by the authorization server, never called by SDK.
  'x-fern-ignore': true,
  'x-excluded': true,
  request: {
    query: OAuthCallbackQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: OAuthCallbackSuccessSchema } },
      description: 'Token exchanged successfully and no `return_to` was given at authorize time.',
    },
    302: {
      description:
        'Redirect to the `return_to` path given at authorize time, with `isSuccess` (and `reason` when it failed) appended to its existing query params.',
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
