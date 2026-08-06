/** Public session wire schemas. Internal stores keep discriminated ref/value bindings. */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema, TokenPaginationSchema } from '@truefoundry/utils-core/agent-session';
import { NameSchema } from './common';

const SessionAgentNameRefSchema = z.object({ name: NameSchema }).strict().openapi('SessionAgentNameRef');

const InlineSessionAgentSchema = AgentSpecSchema.strict().openapi('InlineSessionAgent');

/** The public API uses a name ref or an inline AgentSpec without internal discriminator fields. */
export const SessionWireAgentSchema = z
  .union([SessionAgentNameRefSchema, InlineSessionAgentSchema])
  .openapi('SessionWireAgent');

export const SessionSchema = z
  .object({
    id: z.string(),
    agent: SessionWireAgentSchema,
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Session');

export const CreateSessionRequestSchema = z
  .object({ agent: SessionWireAgentSchema })
  .strict()
  .openapi('CreateSessionRequest');

/** Only inline AgentSpec sessions may be updated; named sessions reject agent updates. */
export const UpdateSessionRequestSchema = z
  .object({ agent: InlineSessionAgentSchema.optional() })
  .strict()
  .openapi('UpdateSessionRequest');

export type Session = z.infer<typeof SessionSchema>;

export const DEFAULT_SESSIONS_LIMIT = 10;
export const SESSIONS_MAX_LIMIT = 100;

/** Wire ISO-8601 (RFC 3339, offsets allowed) → Date for the store. */
const IsoTimestampQueryParam = z.iso
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
    agent_name: NameSchema.optional().describe('When set, only sessions bound to this named agent are returned.'),
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
