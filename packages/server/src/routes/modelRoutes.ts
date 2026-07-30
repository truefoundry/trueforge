import { createRoute, z } from '@hono/zod-openapi';
import { ModelEntrySchema } from '../store/schemas';

const ListModelsResponseSchema = z
  .object({
    data: z.array(ModelEntrySchema),
  })
  .openapi('ListModelsResponse');

export const listModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Models'],
  summary: 'List models',
  'x-fern-sdk-group-name': ['models'],
  'x-fern-sdk-method-name': 'list',
  description: "Models declared in models.yaml, reachable through the OpenAI-compatible API at the file's base_url.",
  responses: {
    200: {
      content: { 'application/json': { schema: ListModelsResponseSchema } },
      description: 'All configured models.',
    },
  },
});
