/**
 * Artifact route definitions (mounted at /api/v1/artifacts).
 * Handlers are registered in apis/artifacts.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { ListArtifactsRequestQuerySchema, ListArtifactsResponseSchema } from '../schemas/artifact';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

export const listArtifactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'List artifacts',
  description:
    'List artifacts created by the caller, most recently updated first. Optionally filter by session, agent, or title substring.',
  'x-fern-sdk-group-name': ['artifacts'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListArtifactsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListArtifactsResponseSchema } },
      description: 'Paginated artifacts.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
  },
});
