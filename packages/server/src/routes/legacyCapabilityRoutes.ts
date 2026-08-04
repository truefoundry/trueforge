/**
 * Legacy capabilities route (mounted at /api/v1/legacy/capabilities).
 * Driven by boot-time SANDBOX_SETTINGS / sandboxFactory — same shape the UI used
 * before GET /api/v1/capabilities gained skill support.
 */
import { createRoute, z } from '@hono/zod-openapi';

const GetLegacyCapabilitiesResponseSchema = z
  .object({
    data: z.object({
      sandbox: z.object({
        enabled: z.boolean().describe('Whether this server has a sandbox provider configured via SANDBOX_SETTINGS.'),
      }),
    }),
  })
  .openapi('GetLegacyCapabilitiesResponse');

export const getLegacyCapabilitiesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Legacy Capabilities'],
  summary: 'Get server capabilities (legacy)',
  'x-fern-sdk-group-name': ['legacy', 'server'],
  'x-fern-sdk-method-name': 'get_capabilities',
  description:
    'Report optional runtime capabilities from boot-time SANDBOX_SETTINGS. Prefer GET /api/v1/capabilities for new clients.',
  responses: {
    200: {
      content: { 'application/json': { schema: GetLegacyCapabilitiesResponseSchema } },
      description: 'Server capabilities (legacy).',
    },
  },
});
