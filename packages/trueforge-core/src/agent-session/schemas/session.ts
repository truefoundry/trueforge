/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`reference` | `inline`). DB stores agent_id / agent_name / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

/** Max key length for session metadata (aligned with LLM gateway HeaderMetadata). */
const SESSION_METADATA_MAX_KEY_LENGTH = 32;
/** Max value length for session metadata (aligned with LLM gateway HeaderMetadata). */
const SESSION_METADATA_MAX_VALUE_LENGTH = 128;
/** Max number of keys in session metadata. */
const SESSION_METADATA_MAX_KEYS = 50;

export const SessionMetadataSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(SESSION_METADATA_MAX_KEY_LENGTH)
      .describe(`Metadata key; 1–${String(SESSION_METADATA_MAX_KEY_LENGTH)} characters.`),
    z
      .string()
      .max(SESSION_METADATA_MAX_VALUE_LENGTH)
      .describe(`Metadata value; at most ${String(SESSION_METADATA_MAX_VALUE_LENGTH)} characters.`),
  )
  .refine(m => Object.keys(m).length <= SESSION_METADATA_MAX_KEYS, {
    message: `at most ${String(SESSION_METADATA_MAX_KEYS)} metadata keys`,
  })
  .describe('Caller-owned session metadata')
  .openapi('SessionMetadata');

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const SessionMetricsSchema = z
  .object({
    total_cost_in_usd: z.number().nonnegative(),
    total_duration_ms: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
  })
  .strict()
  .describe('Rolled-up cost, duration, and turn counters for a session.')
  .openapi('SessionMetrics');

export const SessionAgentReferenceSchema = z
  .object({
    type: z.literal('reference').describe('Bind the session to a named registry agent.'),
    id: z.string().min(1).describe('Registry agent id.'),
    /** Create-time snapshot of the registry agent name; null for legacy/orphan rows. */
    name: z
      .string()
      .nullable()
      .describe('Create-time snapshot of the registry agent name; null for legacy or orphan rows.'),
  })
  .strict()
  .openapi('SessionAgentReference');

export const SessionAgentInlineSchema = z
  .object({
    type: z.literal('inline').describe('Bind the session to an inline AgentSpec (not a registry id).'),
    spec: AgentSpecSchema,
  })
  .strict()
  .openapi('SessionAgentInline');

/** Named registry binding or inline AgentSpec — exactly one arm. */
export const SessionAgentSchema = z
  .discriminatedUnion('type', [SessionAgentReferenceSchema, SessionAgentInlineSchema])
  .openapi('SessionAgent');

export const SessionSchema = z
  .object({
    id: z.string().describe('Unique session id.'),
    agent: SessionAgentSchema,
    title: z.string().nullable().describe('Optional human-readable title; null until set.'),
    /** Caller identity that created the session (immutable). */
    created_by: z.string().describe('Caller identity that created the session (immutable).'),
    created_at: z.string().describe('ISO 8601 creation timestamp.'),
    updated_at: z.string().describe('ISO 8601 last-update timestamp.'),
    metrics: SessionMetricsSchema,
    metadata: SessionMetadataSchema,
  })
  .openapi('Session');

export type SessionAgentReference = z.infer<typeof SessionAgentReferenceSchema>;
export type SessionAgentInline = z.infer<typeof SessionAgentInlineSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;
export type Session = z.infer<typeof SessionSchema>;
