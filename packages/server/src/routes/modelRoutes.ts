import { createRoute } from '@hono/zod-openapi';
import { ListModelsResponseSchema } from '../schemas/modelProvider';

export const listModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Models'],
  summary: 'List models',
  'x-fern-sdk-group-name': ['models'],
  'x-fern-sdk-method-name': 'list',
  description: 'Models across all configured model providers, addressed by fully qualified name `name/model_name`.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListModelsResponseSchema } },
      description: 'All models of all configured providers.',
    },
  },
});
