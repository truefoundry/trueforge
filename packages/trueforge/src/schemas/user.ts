/** Tenant user wire schemas. */
import { z } from '@hono/zod-openapi';
import { TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { PAGE_LIMIT, parseCommaSeparatedQuery } from './common';

const LIST_USERS_PAGE_LIMIT = 100;
const LIST_USERS_MAX_IDS = 100;

export const UserSchema = z
  .object({
    id: z.string().describe('User id, unique within the tenant.'),
    display_name: z.string().describe('Human-readable name for the user.'),
    email: z.string().describe('Email of the user.'),
  })
  .openapi('User');

export const ListUsersRequestQuerySchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Case-insensitive substring match on email or display name.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIST_USERS_PAGE_LIMIT)
      .optional()
      .default(PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(PAGE_LIMIT)}, max ${String(LIST_USERS_PAGE_LIMIT)}.`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
    ids: z
      .string()
      .optional()
      .openapi({
        type: 'string',
        description: `Return only these users (comma-separated ids, up to ${String(LIST_USERS_MAX_IDS)}). Users that are unknown or inactive are omitted. Cannot be combined with \`query\` or \`page_token\`.`,
      })
      .transform(value => parseCommaSeparatedQuery(value))
      .pipe(z.array(z.string().min(1).max(255)).min(1).max(LIST_USERS_MAX_IDS).optional()),
  })
  .refine(q => q.ids === undefined || (q.query === undefined && q.page_token === undefined), {
    message: '`ids` cannot be combined with `query` or `page_token`.',
  })
  .openapi('ListUsersRequestQuery');

export const ListUsersResponseSchema = z
  .object({
    data: z.array(UserSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListUsersResponse');

export type User = z.infer<typeof UserSchema>;
