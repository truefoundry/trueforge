/**
 * Model-provider admin route definitions (mounted at /api/v1/settings/model-providers).
 * Discovery catalog lives at GET /api/v1/catalogs/model-providers.
 * Handlers are registered in apis/modelProviders.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateModelProviderRequestSchema,
  GetModelProviderResponseSchema,
  ListModelProvidersResponseSchema,
  UpdateModelProviderRequestSchema,
} from '../schemas/modelProvider';
import { OpenApiTag } from './openapiTags';

export const listModelProvidersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.MODELS],
  summary: 'List configured model providers',
  description: 'All configured providers with nested manifests.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListModelProvidersResponseSchema } },
      description: 'All configured model providers',
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

export const createModelProviderRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.MODELS],
  summary: 'Create a model provider',
  description:
    'Creates a provider (models included). Fails if `name` is already taken. Well-known types use `type` as `name` (one each); ' +
    '`custom` is named by the caller. `auth.api_key`: real value required; redacted with no stored secret returns 400.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateModelProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetModelProviderResponseSchema } },
      description: 'The created provider',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'A model provider with this name already exists.',
    },
  },
});

export const putModelProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.MODELS],
  summary: 'Create or replace a model provider',
  description:
    'Create or replace a provider (models included). Well-known types use `type` as `name` (one each); ' +
    '`custom` is named by the caller. `auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateModelProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetModelProviderResponseSchema } },
      description: 'The saved provider',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
  },
});
