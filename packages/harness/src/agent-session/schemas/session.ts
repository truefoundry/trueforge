/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`ref` | `value`). DB stores agent_id / agent_name / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionAgentRefSchema = z
  .object({
    type: z.literal('ref'),
    id: z.string().min(1),
    /** Create-time snapshot of the registry agent name; null for legacy/orphan rows. */
    name: z.string().nullable(),
  })
  .strict()
  .openapi('SessionAgentRef');

export const SessionAgentValueSchema = z
  .object({
    type: z.literal('value'),
    def: AgentSpecSchema,
  })
  .strict()
  .openapi('SessionAgentValue');

/** Named registry binding or inline AgentSpec — exactly one arm. */
export const SessionAgentSchema = z
  .discriminatedUnion('type', [SessionAgentRefSchema, SessionAgentValueSchema])
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

export type SessionAgentRef = z.infer<typeof SessionAgentRefSchema>;
export type SessionAgentValue = z.infer<typeof SessionAgentValueSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type Session = z.infer<typeof SessionSchema>;
