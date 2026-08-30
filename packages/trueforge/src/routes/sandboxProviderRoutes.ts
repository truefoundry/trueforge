/**
 * Sandbox-provider admin route definitions (mounted at /api/v1/settings/sandbox-providers).
 * Discovery catalog lives at GET /api/v1/catalogs/sandbox-providers.
 * Handlers are registered in apis/sandboxProviders.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetSandboxProviderResponseSchema, UpdateSandboxProviderRequestSchema } from '../schemas/sandboxProvider';
import { OpenApiTag } from './openapiTags';

export const getSandboxProviderRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Get the configured sandbox provider',
  description: 'The single configured sandbox provider for this tenant. `auth.api_key` is redacted.',
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
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Create or replace the sandbox provider',
  description:
    'Upserts the single sandbox provider for this tenant: creates it or replaces its entire configuration. ' +
    '`auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).',
  'x-fern-sdk-group-name': ['settings', 'sandboxProviders'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateSandboxProviderRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxProviderResponseSchema } },
      description: 'The saved sandbox provider.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted API key with no stored secret to keep.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Daytona rejected the provided API key.',
    },
  },
});
