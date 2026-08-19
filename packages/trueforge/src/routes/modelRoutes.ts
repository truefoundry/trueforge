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
  description: 'Configured models as a slim FQN list for the composer.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableModelsResponseSchema } },
      description: 'All configured models (chat projection).',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});
