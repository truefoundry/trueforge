/**
 * Model-provider route definitions (mounted at /api/v1/settings/model-providers).
 * Handlers are registered in apis/modelProviders.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetModelProviderCatalogResponseSchema } from '../schemas/modelCatalog';
import {
  ListModelProvidersResponseSchema,
  PutModelProviderRequestSchema,
  PutModelProviderResponseSchema,
} from '../schemas/modelProvider';

const MODEL_PROVIDERS_TAG = 'Model Providers';

export const getModelProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/catalog',
  tags: [MODEL_PROVIDERS_TAG],
  summary: 'Get the model catalog',
  description:
    'Provider and model presets shipped with the server (model-catalog.yaml). Discovery-only: an entry becomes a ' +
    'PUT /settings/model-providers body once the catalog-only `logo` and `name` are dropped and `auth` is added. ' +
    'Includes a `custom` sentinel with `supported_reasoning_efforts` for the custom-provider form (not configurable from catalog).',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'catalog',
  responses: {
    200: {
      content: { 'application/json': { schema: GetModelProviderCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
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

export const listModelProvidersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [MODEL_PROVIDERS_TAG],
  summary: 'List configured model providers',
  description: 'All configured providers with their models.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListModelProvidersResponseSchema } },
      description: 'All configured model providers.',
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

export const putModelProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [MODEL_PROVIDERS_TAG],
  summary: 'Create or replace a model provider',
  description:
    'Full upsert: creates the provider or replaces its entire configuration (models included). The key is the ' +
    'returned `name`, which every type but `custom` takes from its own `type`, so each is limited to one ' +
    'configured provider and a repeat call replaces it; only `custom` providers are named by the caller.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'upsert',
  request: {
    body: {
      content: { 'application/json': { schema: PutModelProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PutModelProviderResponseSchema } },
      description: 'The saved provider.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
  },
});
