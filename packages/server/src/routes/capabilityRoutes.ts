import { createRoute, z } from '@hono/zod-openapi';

const GetCapabilitiesResponseSchema = z
  .object({
    data: z.object({
      sandbox: z.object({
        enabled: z.boolean().describe('Whether this server has a sandbox provider configured.'),
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
  description: 'Report optional runtime capabilities available in this server deployment.',
  responses: {
    200: {
      content: { 'application/json': { schema: GetCapabilitiesResponseSchema } },
      description: 'Server capabilities.',
    },
  },
});
