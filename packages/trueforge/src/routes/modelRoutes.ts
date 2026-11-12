import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { ListAvailableModelsResponseSchema } from '../schemas/modelProvider';
import { OpenApiTag } from './openapiTags';

/** Chat/composer read view — mounted at /api/v1/models (not under settings). */
export const listAvailableModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.MODELS],
  summary: 'List models for chat',
  'x-fern-sdk-group-name': ['models'],
  'x-fern-sdk-method-name': 'list',
  'x-tfg-mcp': {
    name: 'list_models',
    description:
      'List the models you can reference in an agent or draft manifest. Use it to find a valid model ' +
      'identifier before setting one on an agent.',
    annotations: { readOnlyHint: true },
  },
  description: 'Configured models as a slim FQN list for the composer.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableModelsResponseSchema } },
      description: 'All configured models (chat projection).',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Auth is configured and the request has no valid no Bearer token or session cookie.',
    },
  },
});
