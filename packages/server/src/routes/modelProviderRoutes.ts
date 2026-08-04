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
    'Provider and model presets shipped with the server (model-catalog.yaml). Discovery-only: copy an entry ' +
    'into PUT /settings/model-providers to configure it. Custom providers are not listed here.',
  'x-fern-sdk-group-name': ['settings', 'modelProviders'],
  'x-fern-sdk-method-name': 'catalog',
  responses: {
    200: {
      content: { 'application/json': { schema: GetModelProviderCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
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
  },
});

export const putModelProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [MODEL_PROVIDERS_TAG],
  summary: 'Create or replace a model provider',
  description:
    'Full upsert keyed by `name`: creates the provider or replaces its entire configuration (models included).',
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
