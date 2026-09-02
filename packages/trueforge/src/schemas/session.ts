/** Server session wire schemas. Core Session lives in agentSession. */
import { z } from '@hono/zod-openapi';
import {
  AgentSpecSchema,
  SessionMetadataSchema,
  SessionSchema,
  TokenPaginationSchema,
} from '@truefoundry/trueforge-core/agent-session';
import { NameSchema, PAGE_LIMIT } from './common';

/** Create arm: bind by unique registry agent name. */
export const SessionAgentNameRefSchema = z.object({ name: NameSchema }).strict().openapi('SessionAgentNameRef');

/**
 * Create/update body arm wrapping an AgentSpec.
 * Use AgentSpecSchema (not `.strict()`) so OpenAPI `$ref`s the shared AgentSpec.
 */
const SessionAgentSpecBodySchema = z.object({ spec: AgentSpecSchema }).strict().openapi('SessionAgentSpecBody');

/** Create accepts either a unique agent name or `{ spec: AgentSpec }`. */
export const CreateSessionAgentSchema = z
  .union([SessionAgentNameRefSchema, SessionAgentSpecBodySchema])
  .openapi('CreateSessionAgent');

export type CreateSessionAgent = z.infer<typeof CreateSessionAgentSchema>;
export type SessionAgentNameRef = z.infer<typeof SessionAgentNameRefSchema>;
export type SessionAgentSpecBody = z.infer<typeof SessionAgentSpecBodySchema>;

/** Narrows the create-body union after OpenAPI already accepted either arm. */
export function isSessionAgentNameRef(agent: CreateSessionAgent): agent is SessionAgentNameRef {
  return SessionAgentNameRefSchema.safeParse(agent).success;
}

export const CreateSessionRequestSchema = z
  .object({
    agent: CreateSessionAgentSchema,
    metadata: SessionMetadataSchema.optional(),
  })
  .strict()
  .openapi('CreateSessionRequest');

export const GetOrCreateSessionByExternalIdRequestSchema = z
  .object({
    external_id: z.string().min(1).max(128).describe('Caller-supplied id unique within the tenant.'),
    agent: CreateSessionAgentSchema,
  })
  .strict()
  .openapi('GetOrCreateSessionByExternalIdRequest');

/** Only inline sessions may be updated; named (reference) sessions reject agent updates. */
export const UpdateSessionRequestSchema = z
  .object({
    agent: SessionAgentSpecBodySchema.optional(),
    metadata: SessionMetadataSchema.optional(),
  })
  .strict()
  .openapi('UpdateSessionRequest');

export type { Session } from '@truefoundry/trueforge-core/agent-session';

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
      .max(PAGE_LIMIT)
      .optional()
      .default(PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(PAGE_LIMIT)}, max ${String(PAGE_LIMIT)}.`),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .default('desc')
      .describe('Sort sessions by `updated_at`. Defaults to "desc".')
      .openapi('ListSessionsOrder'),
    page_token: z
      .string()
      .min(1)
      .optional()
      .describe('Opaque keyset cursor from a previous response `next_page_token`.'),
    start_timestamp: IsoTimestampQueryParam.optional().describe(
      'Inclusive lower bound on `created_at` (ISO-8601 / RFC 3339).',
    ),
    end_timestamp: IsoTimestampQueryParam.optional().describe(
      'Inclusive upper bound on `created_at` (ISO-8601 / RFC 3339).',
    ),
    agent_id: z.string().min(1).optional().describe('When set, only sessions bound to this agent id are returned.'),
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
