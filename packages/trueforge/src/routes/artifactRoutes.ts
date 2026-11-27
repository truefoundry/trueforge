/**
 * Artifact route definitions (mounted at /api/v1/artifacts).
 * Handlers are registered in apis/artifacts.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  ListArtifactsRequestQuerySchema,
  ListArtifactsResponseSchema,
  UpdateArtifactRequestSchema,
  UpdateArtifactResponseSchema,
} from '../schemas/artifact';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

const ArtifactIdParamsSchema = z.object({
  artifact_id: z.string().min(1).describe('Artifact identifier.'),
});

export const listArtifactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'List artifacts',
  description:
    'List artifacts created by the caller, most recently updated first. Optionally filter by session or name substring.',
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

export const updateArtifactRoute = createRoute({
  method: 'post',
  path: '/{artifact_id}/update',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Update an artifact',
  description: 'Update an artifact.',
  'x-fern-sdk-group-name': ['artifacts'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: ArtifactIdParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateArtifactRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateArtifactResponseSchema } },
      description: 'Artifact updated.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the artifact creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Artifact not found.',
    },
  },
});
