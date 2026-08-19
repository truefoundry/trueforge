/**
 * Configured agent domain + wire schemas: identity columns plus a nested
 * AgentSpec document (JSON key `manifest`).
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { NameSchema } from './common';

/** Create body: unique immutable `name` plus manifest. `id` is never client-supplied. */
export const CreateAgentRequestSchema = z
  .object({
    name: NameSchema,
    manifest: AgentSpecSchema,
  })
  .strict()
  .openapi('CreateAgentRequest');

/** PUT body: full manifest replacement. Identity is the path `agent_id`. */
export const UpdateAgentRequestSchema = z
  .object({
    manifest: AgentSpecSchema,
  })
  .strict()
  .openapi('UpdateAgentRequest');

/** List/get/create/update response item: identity columns plus nested manifest. */
export const AgentSchema = z
  .object({
    id: z.string().min(1).describe('Immutable server-generated agent identifier.'),
    name: NameSchema,
    manifest: AgentSpecSchema,
  })
  .strict()
  .openapi('Agent');

export const GetAgentResponseSchema = z.object({ data: AgentSchema }).openapi('GetAgentResponse');
export const ListAgentsResponseSchema = z.object({ data: z.array(AgentSchema) }).openapi('ListAgentsResponse');
export const DeleteAgentResponseSchema = z.object({}).openapi('DeleteAgentResponse');

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;
