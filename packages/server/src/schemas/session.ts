/** Server session wire schemas. Core Session/Create/Update live in agentSession. */
import { z } from '@hono/zod-openapi';
import {
  CreateSessionRequestSchema,
  SessionSchema,
  TokenPaginationSchema,
  UpdateSessionRequestSchema,
} from '@truefoundry/utils/agent-session';

export type { Session } from '@truefoundry/utils/agent-session';
export { CreateSessionRequestSchema, UpdateSessionRequestSchema };

export const DEFAULT_SESSIONS_LIMIT = 10;
export const SESSIONS_MAX_LIMIT = 100;

/** Wire ISO-8601 (RFC 3339, offsets allowed) → Date for the store. */
const IsoTimestampQueryParam = z
  .string()
  .datetime({ offset: true })
  .openapi({ type: 'string', format: 'date-time' })
  .transform(s => new Date(s));

export const ListSessionsRequestQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SESSIONS_MAX_LIMIT)
      .optional()
      .default(DEFAULT_SESSIONS_LIMIT)
      .describe(`Page size. Defaults to ${String(DEFAULT_SESSIONS_LIMIT)}, max ${String(SESSIONS_MAX_LIMIT)}.`),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .default('desc')
      .describe('Sort sessions by creation time. Defaults to "desc".')
      .openapi('ListSessionsOrder'),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
    start_timestamp: IsoTimestampQueryParam.optional().describe(
      'Inclusive lower bound on `created_at` (ISO-8601 / RFC 3339).',
    ),
    end_timestamp: IsoTimestampQueryParam.optional().describe(
      'Inclusive upper bound on `created_at` (ISO-8601 / RFC 3339).',
    ),
  })
  .openapi('ListSessionsRequestQuery');

export const GetSessionResponseSchema = z
  .object({
    data: SessionSchema,
  })
  .openapi('GetSessionResponse');

export const ListSessionsResponseSchema = z
  .object({
    data: z.array(SessionSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListSessionsResponse');
