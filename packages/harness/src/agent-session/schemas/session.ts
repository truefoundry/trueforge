/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`reference` | `inline`). DB stores agent_id / agent_name / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionAgentReferenceSchema = z
  .object({
    type: z.literal('reference'),
    id: z.string().min(1),
    /** Create-time snapshot of the registry agent name; null for legacy/orphan rows. */
    name: z.string().nullable(),
  })
  .strict()
  .openapi('SessionAgentReference');

export const SessionAgentInlineSchema = z
  .object({
    type: z.literal('inline'),
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
    id: z.string(),
    agent: SessionAgentSchema,
    title: z.string().nullable(),
    /** Caller identity that created the session (immutable). */
    created_by: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Session');

export type SessionAgentReference = z.infer<typeof SessionAgentReferenceSchema>;
export type SessionAgentInline = z.infer<typeof SessionAgentInlineSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type Session = z.infer<typeof SessionSchema>;
