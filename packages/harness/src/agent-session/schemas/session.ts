/** Session product schemas. A session owns an inline AgentSpec. */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionSchema = z
  .object({
    id: z.string(),
    agent_spec: AgentSpecSchema,
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    total_cost_in_usd: z.number().nonnegative(),
    total_duration_ms: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
    last_activity_at: z.string(),
  })
  .openapi('Session');

export const CreateSessionRequestSchema = z
  .object({
    agent_spec: AgentSpecSchema,
  })
  .openapi('CreateSessionRequest');

export const UpdateSessionRequestSchema = z
  .object({
    agent_spec: AgentSpecSchema.optional(),
  })
  .openapi('UpdateSessionRequest');

export type Session = z.infer<typeof SessionSchema>;
