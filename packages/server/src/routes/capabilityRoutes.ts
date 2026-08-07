import { createRoute, z } from '@hono/zod-openapi';

const GetCapabilitiesResponseSchema = z
  .object({
    data: z.object({
      sandbox: z.object({
        enabled: z.boolean().describe('Whether a sandbox provider is configured for this tenant.'),
      }),
      skill: z.object({
        enabled: z
          .boolean()
          .describe('Whether skills are available. False when sandbox is not enabled (skills require a sandbox).'),
      }),
      settings: z.object({
        enabled: z.boolean().describe('Whether the settings UI/API is enabled.'),
      }),
    }),
  })
  .openapi('GetCapabilitiesResponse');

export const getCapabilitiesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Capabilities'],
  summary: 'Get server capabilities',
  'x-fern-sdk-group-name': ['server'],
  'x-fern-sdk-method-name': 'get_capabilities',
  description: 'Report optional runtime capabilities available for this tenant.',
  responses: {
    200: {
      content: { 'application/json': { schema: GetCapabilitiesResponseSchema } },
      description: 'Server capabilities.',
    },
  },
});
