import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetWebSearchProviderResponseSchema, UpdateWebSearchProviderRequestSchema } from '../schemas/webSearchProvider';
import { OpenApiTag } from './openapiTags';

export const getWebSearchProviderRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.WEB_SEARCH],
  summary: 'Get the web search provider',
  description: 'The configured provider for this tenant. `auth.api_key` is redacted when present.',
  'x-fern-sdk-group-name': ['settings', 'webSearchProviders'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetWebSearchProviderResponseSchema } },
      description: 'The configured web search provider.',
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
      description: 'No web search provider configured.',
    },
  },
});

export const putWebSearchProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.WEB_SEARCH],
  summary: 'Create or replace the web search provider',
  description:
    'Upserts the single web search provider for this tenant. ' +
    '`auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).',
  'x-fern-sdk-group-name': ['settings', 'webSearchProviders'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateWebSearchProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetWebSearchProviderResponseSchema } },
      description: 'The saved provider.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unsupported operation because web-search providers are managed by an external system',
    },
  },
});
