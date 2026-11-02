import { createRoute } from '@hono/zod-openapi';
import { GetConfigurationsResponseSchema, UpdateConfigurationsRequestSchema } from '../schemas/configurations';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const getConfigurationsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.CONFIGURATIONS],
  summary: 'Get the tenant configurations',
  description: 'Tenant-wide feature switches. Tenants with nothing saved yet get every switch enabled.',
  'x-fern-sdk-group-name': ['settings', 'configurations'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetConfigurationsResponseSchema } },
      description: 'The tenant configurations.',
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

export const patchConfigurationsRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: [OpenApiTag.CONFIGURATIONS],
  summary: 'Update the tenant configurations',
  description:
    'Updates the switches present in the body and leaves the rest. Turning web search off applies to new chats; chats already using it keep it.',
  'x-fern-sdk-group-name': ['settings', 'configurations'],
  'x-fern-sdk-method-name': 'update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateConfigurationsRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetConfigurationsResponseSchema } },
      description: 'The saved tenant configurations.',
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
