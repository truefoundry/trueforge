import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetTenantSettingResponseSchema, UpdateTenantSettingRequestSchema } from '../schemas/tenantSetting';
import { OpenApiTag } from './openapiTags';

export const getTenantSettingRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.TENANT_SETTINGS],
  summary: 'Get the tenant settings',
  description: 'Tenant-wide feature switches. Tenants with nothing saved yet get every switch enabled.',
  'x-fern-sdk-group-name': ['settings', 'tenantSettings'],
  'x-fern-sdk-method-name': 'get',
  responses: {
    200: {
      content: { 'application/json': { schema: GetTenantSettingResponseSchema } },
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

export const putTenantSettingRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.TENANT_SETTINGS],
  summary: 'Create or replace the tenant settings',
  description:
    'Replaces the tenant-wide switches. Turning web search off applies to new chats; chats already using it keep it.',
  'x-fern-sdk-group-name': ['settings', 'tenantSettings'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateTenantSettingRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetTenantSettingResponseSchema } },
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
