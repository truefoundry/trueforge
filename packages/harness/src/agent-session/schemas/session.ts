/**
 * Session product schemas. Wire Session is agent_id XOR agent_spec;
 * SessionAgentSource is the turn-time binding view derived from SessionRecord.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionSchema = z
  .object({
    id: z.string(),
    agent_id: z.string().nullable(),
    agent_spec: AgentSpecSchema.nullable(),
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Session');

/**
 * Create binds exactly one of inline draft (`agent_spec`) or named registry
 * (`agent_id`). No shared discriminator — `z.union` of strict objects.
 */
export const CreateSessionRequestSchema = z
  .union([
    z
      .object({
        agent_spec: AgentSpecSchema,
      })
      .strict(),
    z
      .object({
        agent_id: z.string().min(1),
      })
      .strict(),
  ])
  .openapi('CreateSessionRequest');

/** Draft sessions only may patch `agent_spec`; named sessions reject it at the store. */
export const UpdateSessionRequestSchema = z
  .object({
    agent_spec: AgentSpecSchema.optional(),
  })
  .openapi('UpdateSessionRequest');

/**
 * How a session binds its agent for turn-time resolve: inline blob or named id.
 * Exactly one arm is persisted on SessionRecord (XOR).
 */
export const SessionAgentSourceSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('inline'),
        agent_spec: AgentSpecSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('named'),
        agent_id: z.string().min(1),
      })
      .strict(),
  ])
  .openapi('SessionAgentSource');

export type Session = z.infer<typeof SessionSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SessionAgentSource = z.infer<typeof SessionAgentSourceSchema>;
