/**
 * Sandbox-provider admin route definitions (mounted at /api/v1/settings/sandbox-providers).
 * Discovery catalog lives at GET /api/v1/catalog/sandbox-providers.
 * Handlers are registered in apis/sandboxProviders.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  GetSandboxProviderResponseSchema,
  PutSandboxProviderRequestSchema,
  PutSandboxProviderResponseSchema,
} from '../schemas/sandboxProvider';

const SANDBOX_PROVIDERS_TAG = 'Sandbox Providers';

export const getSandboxProviderRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [SANDBOX_PROVIDERS_TAG],
  summary: 'Get the configured sandbox provider',
  description: 'The single configured sandbox provider for this tenant.',
  'x-fern-sdk-group-name': ['settings', 'sandboxProviders'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxProviderResponseSchema } },
      description: 'The configured sandbox provider.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'No sandbox provider configured.',
    },
  },
});

export const putSandboxProviderRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [SANDBOX_PROVIDERS_TAG],
  summary: 'Create or replace the sandbox provider',
  description: 'Upserts the single sandbox provider for this tenant: creates it or replaces its entire configuration.',
  'x-fern-sdk-group-name': ['settings', 'sandboxProviders'],
  'x-fern-sdk-method-name': 'upsert',
  request: {
    body: {
      content: { 'application/json': { schema: PutSandboxProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PutSandboxProviderResponseSchema } },
      description: 'The saved sandbox provider.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
  },
});
