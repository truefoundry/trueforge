/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`reference` | `inline`). DB stores agent_id / agent_name / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

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
  })
  .openapi('Session');

export type SessionAgentReference = z.infer<typeof SessionAgentReferenceSchema>;
export type SessionAgentInline = z.infer<typeof SessionAgentInlineSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type Session = z.infer<typeof SessionSchema>;
