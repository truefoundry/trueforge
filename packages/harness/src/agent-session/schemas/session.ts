/** Internal session agent binding persisted by stores and consumed at runtime. */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionAgentRefSchema = z
  .object({
    type: z.literal('ref'),
    agent_id: z.string().min(1),
  })
  .strict()
  .openapi('SessionAgentRef');

export const SessionAgentValueSchema = z
  .object({
    type: z.literal('value'),
    agent_spec: AgentSpecSchema,
  })
  .strict()
  .openapi('SessionAgentValue');

/** Internal named registry binding or inline draft spec — exactly one arm. */
export const SessionAgentSchema = z
  .discriminatedUnion('type', [SessionAgentRefSchema, SessionAgentValueSchema])
  .openapi('SessionAgent');

export type SessionAgentRef = z.infer<typeof SessionAgentRefSchema>;
export type SessionAgentValue = z.infer<typeof SessionAgentValueSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
