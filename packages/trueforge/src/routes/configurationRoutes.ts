import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { CreateOrUpdateSettingsSchema, GetSettingsResponseSchema } from '../schemas/settings';
import { OpenApiTag } from './openapiTags';

export const getSettingsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.CONFIGURATION],
  summary: 'Get the tenant settings',
  description: 'Tenant-wide feature switches. Tenants with nothing saved yet get every switch enabled.',
  'x-fern-sdk-group-name': ['settings', 'configuration'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSettingsResponseSchema } },
      description: 'The tenant settings.',
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

export const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: [OpenApiTag.CONFIGURATION],
  summary: 'Update the tenant settings',
  description:
    'Updates the switches present in the body and leaves the rest. Turning web search off applies to new chats; chats already using it keep it.',
  'x-fern-sdk-group-name': ['settings', 'configuration'],
  'x-fern-sdk-method-name': 'update',
  request: {
    body: {
      content: { 'application/json': { schema: CreateOrUpdateSettingsSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSettingsResponseSchema } },
      description: 'The saved tenant settings.',
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
