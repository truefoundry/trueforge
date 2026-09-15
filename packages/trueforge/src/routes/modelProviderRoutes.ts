/**
 * Model-provider admin route definitions (mounted at /api/v1/settings/model-providers).
 * Discovery catalog lives at GET /api/v1/catalogs/model-providers.
 * Handlers are registered in apis/modelProviders.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateModelProviderRequestSchema,
  GetModelProviderResponseSchema,
  ListDiscoveredModelsResponseSchema,
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
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unsupported operation because the model providers are managed by external system',
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
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unsupported operation because the model providers are managed by external system',
    },
  },
});

export const listDiscoveredModelsRoute = createRoute({
  method: 'get',
  path: '/{name}/discovered-models',
  tags: [OpenApiTag.MODELS],
  summary: 'List the models a configured provider reports',
  description:
    'Asks the provider itself which models it serves, using the stored API key. Returns token limits ' +
    'when the provider reports them (Gemini does; the OpenAI-compatible list does not). The shipped ' +
    'catalog is a preset list and may lag the provider, so this is the current source of truth.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'discovered_models',
  request: {
    params: z.object({
      name: z.string().min(1).describe('Configured provider resource name, e.g. `google-gemini`.'),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListDiscoveredModelsResponseSchema } },
      description: 'Models the provider reports',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'No provider is configured under this name.',
    },
    501: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'This provider type has no discovery adapter.',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The provider was unreachable or rejected the request.',
    },
  },
});
