import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetMemoryProviderResponseSchema, UpdateMemoryProviderRequestSchema } from '../schemas/memoryProvider';
import { OpenApiTag } from './openapiTags';

export const getMemoryProviderRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.MEMORY],
  summary: 'Get the memory provider',
  description: 'The configured provider for this tenant. `auth.api_key` is redacted when present.',
  'x-fern-sdk-group-name': ['settings', 'memoryProviders'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetMemoryProviderResponseSchema } },
      description: 'The configured memory provider.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid Bearer token or auth cookie.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Authenticated but not an admin.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'No memory provider configured.',
    },
  },
});

export const putMemoryProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.MEMORY],
  summary: 'Create or replace the memory provider',
  description:
    'Upserts the single memory provider for this tenant. ' +
    '`auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).',
  'x-fern-sdk-group-name': ['settings', 'memoryProviders'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateMemoryProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetMemoryProviderResponseSchema } },
      description: 'The saved provider.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unsupported operation because memory providers are managed by an external system',
    },
  },
});
