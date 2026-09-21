import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateWebSearchProviderRequestSchema,
  GetWebSearchProviderResponseSchema,
  ListWebSearchProvidersResponseSchema,
  UpdateWebSearchProviderRequestSchema,
} from '../schemas/webSearchProvider';
import { OpenApiTag } from './openapiTags';

export const listWebSearchProvidersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.WEB_SEARCH],
  summary: 'List configured web-search providers',
  description: 'All configured providers with nested manifests. `auth.api_key` is redacted.',
  'x-fern-sdk-group-name': ['settings', 'webSearchProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListWebSearchProvidersResponseSchema } },
      description: 'All configured web-search providers',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the caller is authenticated but not an admin.',
    },
  },
});

export const createWebSearchProviderRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.WEB_SEARCH],
  summary: 'Create a web-search provider',
  description:
    'Creates a provider. Fails if `name` is already taken. Well-known types use `type` as `name` (one each). ' +
    '`auth.api_key`: real value required; redacted with no stored secret returns 400.',
  'x-fern-sdk-group-name': ['settings', 'webSearchProviders'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateWebSearchProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetWebSearchProviderResponseSchema } },
      description: 'The created provider',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'A web-search provider with this name already exists.',
    },
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unsupported operation because web-search providers are managed by an external system',
    },
  },
});

export const putWebSearchProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.WEB_SEARCH],
  summary: 'Create or replace a web-search provider',
  description:
    'Create or replace a provider. Well-known types use `type` as `name` (one each). ' +
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
      description: 'The saved provider',
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
