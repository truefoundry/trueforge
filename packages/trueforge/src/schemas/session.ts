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

/** Max metadata equality filters on list sessions (clause-budget style). */
export const LIST_SESSIONS_METADATA_FILTER_MAX_KEYS = 10;

const METADATA_EQUAL_KEY = /^metadata\[([^\]]+)\]$/;
/** `metadata[key][…]` — nested brackets beyond a single key. */
const METADATA_NESTED_BRACKETS = /^metadata\[[^\]]*\]\[[^\]]+\]/;

function metadataQueryIssue(message: string): z.ZodError {
  return new z.ZodError([
    {
      code: 'custom',
      path: ['metadata'],
      message,
    },
  ]);
}

function requireSingleString({ key, value }: { key: string; value: unknown }): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    throw metadataQueryIssue(`Query parameter "${key}" must appear at most once`);
  }
  throw metadataQueryIssue(`Query parameter "${key}" must be a string`);
}

/**
 * Fold Hono's flat deepObject query keys into `{ metadata: { key: value } }`.
 * Passes non-metadata keys through unchanged.
 *
 * - `metadata[key]=value` → equality filter
 * - `metadata[key][…]=…` → rejected (only one bracket level is allowed)
 * - bare `metadata=…` → rejected (no JSON-string dual support)
 */
export function foldListSessionsMetadataQuery(query: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const metadata: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (key === 'metadata') {
      throw metadataQueryIssue('Use metadata[key]=value query parameters; bare metadata is not supported');
    }

    if (METADATA_NESTED_BRACKETS.test(key)) {
      throw metadataQueryIssue(
        'Nested metadata query parameters like metadata[key][…] are not supported; use metadata[key]=value',
      );
    }

    const equalMatch = METADATA_EQUAL_KEY.exec(key);
    if (equalMatch) {
      const metaKey = equalMatch[1];
      if (metaKey === undefined || metaKey.length === 0) {
        throw metadataQueryIssue('Metadata filter key must be non-empty');
      }
      if (Object.hasOwn(metadata, metaKey)) {
        throw metadataQueryIssue(`Duplicate metadata filter key "${metaKey}"`);
      }
      metadata[metaKey] = requireSingleString({ key, value });
      continue;
    }

    if (key.startsWith('metadata[')) {
      throw metadataQueryIssue(`Invalid metadata query parameter "${key}"`);
    }

    out[key] = value;
  }

  const filterKeyCount = Object.keys(metadata).length;
  if (filterKeyCount > LIST_SESSIONS_METADATA_FILTER_MAX_KEYS) {
    throw metadataQueryIssue(`at most ${String(LIST_SESSIONS_METADATA_FILTER_MAX_KEYS)} metadata filter keys`);
  }
  if (filterKeyCount > 0) {
    out['metadata'] = metadata;
  }

  return out;
}

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
    metadata: SessionMetadataSchema.optional()
      .openapi({
        description: 'Exact metadata pairs as metadata[key]=value. Sessions must contain all pairs.',
        param: { style: 'deepObject', explode: true },
      })
      .transform(metadata => (metadata === undefined || Object.keys(metadata).length === 0 ? undefined : metadata)),
  })
  .openapi('ListSessionsRequestQuery');

export type ListSessionsRequestQuery = z.infer<typeof ListSessionsRequestQuerySchema>;

/**
 * Parse list-sessions query after folding Hono's flat `metadata[key]` params.
 * OpenAPIHono's query validator cannot nest deepObject keys; callers pass `c.req.queries()`.
 */
export function parseListSessionsQuery(raw: object): ListSessionsRequestQuery {
  return ListSessionsRequestQuerySchema.parse(foldListSessionsMetadataQuery(raw));
}

/** Normalize Hono `queries()` (string | string[]) into a flat record for parseListSessionsQuery. */
export function honoQueriesToRecord(queries: Record<string, string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(queries)) {
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

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
