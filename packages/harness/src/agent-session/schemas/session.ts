/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`ref` | `value`). DB may still store agent_id / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

/** Named registry binding or inline draft spec — exactly one arm. */
export const SessionAgentSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('ref'),
        agent_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal('value'),
        agent_spec: AgentSpecSchema,
      })
      .strict(),
  ])
  .openapi('SessionAgent');

export const SessionSchema = z
  .object({
    id: z.string(),
    agent: SessionAgentSchema,
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Session');

/** Create binds a single agent (ref or value). */
export const CreateSessionRequestSchema = z
  .object({
    agent: SessionAgentSchema,
  })
  .strict()
  .openapi('CreateSessionRequest');

/** Draft sessions only may replace the value agent; named (ref) sessions reject it. */
export const UpdateSessionRequestSchema = z
  .object({
    agent: z
      .object({
        type: z.literal('value'),
        agent_spec: AgentSpecSchema,
      })
      .strict()
      .optional(),
  })
  .openapi('UpdateSessionRequest');

export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
