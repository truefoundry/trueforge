/**
 * Internal permissions route definitions (mounted at /api/internal).
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { ListPermissionsRequestSchema, ListPermissionsResponseSchema } from '../schemas/permissions';
import { OpenApiTag } from './openapiTags';

export const listPermissionsRoute = createRoute({
  method: 'post',
  path: '/list-permissions',
  tags: [OpenApiTag.INTERNAL],
  summary: 'List permissions for resources',
  description: 'Return granted actions (MANAGE, DELETE) for each requested agent, schedule, or session id.',
  'x-fern-sdk-group-name': ['internal'],
  'x-fern-sdk-method-name': 'list_permissions',
  request: {
    body: {
      content: { 'application/json': { schema: ListPermissionsRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListPermissionsResponseSchema } },
      description: 'Permissions keyed by resource id.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
  },
});
