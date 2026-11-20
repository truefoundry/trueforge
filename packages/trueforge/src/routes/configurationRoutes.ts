import { createRoute } from '@hono/zod-openapi';
import { GetConfigurationResponseSchema, UpdateConfigurationRequestSchema } from '../schemas/configuration';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const getConfigurationRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.CONFIGURATION],
  summary: 'Get the tenant configuration',
  description: 'Tenant-wide feature switches. Tenants with nothing saved yet get every switch enabled.',
  'x-fern-sdk-group-name': ['settings', 'configuration'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetConfigurationResponseSchema } },
      description: 'The tenant configuration.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid Bearer token or auth cookie.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Authenticated but not an admin.',
    },
  },
});

export const patchConfigurationRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: [OpenApiTag.CONFIGURATION],
  summary: 'Update the tenant configuration',
  description:
    'Updates the switches present in the body and leaves the rest. Turning web search off applies to new chats; chats already using it keep it.',
  'x-fern-sdk-group-name': ['settings', 'configuration'],
  'x-fern-sdk-method-name': 'update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateConfigurationRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetConfigurationResponseSchema } },
      description: 'The saved tenant configuration.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid Bearer token or auth cookie.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Authenticated but not an admin.',
    },
  },
});
