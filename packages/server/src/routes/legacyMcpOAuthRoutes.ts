import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';

const MCP_OAUTH_TAG = 'Legacy MCP OAuth';

const McpOAuthCallbackQuerySchema = z.object({
  state: z.string().min(1).describe('Opaque token; correlates this callback to its pending authorization.'),
  code: z.string().min(1).optional().describe('Authorization code, present when the user granted consent.'),
  error: z
    .string()
    .optional()
    .describe('OAuth error code, present instead of `code` if the user denied consent or the IdP errored.'),
  error_description: z.string().optional(),
});

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
    302: {
      description: 'Redirects to the original `redirect_url` on success, or a failure page if `error` was present.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unknown or expired `state` (no matching pending authorization), or `code`/`error` both missing.',
    },
  },
});
