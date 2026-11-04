/**
 * User directory route definitions (mounted at /api/v1/users).
 * Handlers are registered in apis/users.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { ListUsersRequestQuerySchema, ListUsersResponseSchema } from '../schemas/user';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

export const listUsersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.USERS],
  summary: 'List users',
  description:
    'List users in the tenant that sessions can be shared with. Searches email and display name, or looks up specific users with `ids`.',
  'x-fern-sdk-group-name': ['users'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListUsersRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListUsersResponseSchema } },
      description: 'Paginated users.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
    },
  },
});
