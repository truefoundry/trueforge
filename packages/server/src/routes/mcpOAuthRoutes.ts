import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';

const MCP_OAUTH_TAG = 'MCP OAuth';

const McpOAuthCallbackQuerySchema = z.object({
  state: z.string().min(1).describe('Opaque token; correlates this callback to its pending authorization.'),
  code: z.string().min(1).optional().describe('Authorization code, present when the user granted consent.'),
  error: z
    .string()
    .optional()
    .describe('OAuth error code, present instead of `code` if the user denied consent or the IdP errored.'),
  error_description: z.string().optional(),
});

const McpOAuthCallbackSuccessSchema = z
  .object({
    success: z.literal(true),
  })
  .openapi('McpOAuthCallbackSuccess');

export const mcpOAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: [MCP_OAUTH_TAG],
  summary: 'OAuth callback for MCP authorization',
  // Browser-redirect target hit directly by the authorization server, never called by SDK.
  'x-fern-ignore': true,
  request: {
    query: McpOAuthCallbackQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: McpOAuthCallbackSuccessSchema } },
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
