/**
 * Artifact route definitions (mounted at /api/v1/artifacts).
 * Handlers are registered in apis/artifacts.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  GetArtifactResponseSchema,
  ListArtifactsRequestQuerySchema,
  ListArtifactsResponseSchema,
} from '../schemas/artifact';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

const ArtifactSlugParamsSchema = z.object({
  slug: z.string().min(1).describe('Artifact slug.'),
});

export const listArtifactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'List artifacts',
  description: 'List artifacts for the tenant, newest first.',
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
  },
});

export const getArtifactRoute = createRoute({
  method: 'get',
  path: '/{slug}',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Get an artifact',
  description: 'Get an artifact by slug.',
  'x-fern-sdk-group-name': ['artifacts'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: ArtifactSlugParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetArtifactResponseSchema } },
      description: 'The artifact.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found.',
    },
  },
});
