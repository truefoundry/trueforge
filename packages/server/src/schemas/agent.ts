/**
 * Configured agent domain + wire schemas: identity columns plus an AgentSpec
 * manifest document. AgentSpec remains owned by harness; this module only adds
 * registry identity (`id`, `name`).
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema, type AgentSpec } from '@truefoundry/utils-core/agent-session';
import { NameSchema } from './common';

/** Create/update body: unique `name` plus full AgentSpec. `id` is never client-supplied. */
export const AgentWriteRequestSchema = AgentSpecSchema.extend({
  name: NameSchema,
}).openapi('AgentWriteRequest');

/** List/get/create/update response item: immutable `id`, unique mutable `name`, and AgentSpec fields. */
export const AgentSchema = AgentSpecSchema.extend({
  id: z.string().min(1).describe('Immutable server-generated agent identifier.'),
  name: NameSchema,
}).openapi('Agent');

export const CreateAgentResponseSchema = z.object({ data: AgentSchema }).openapi('CreateAgentResponse');
export const PutAgentResponseSchema = z.object({ data: AgentSchema }).openapi('PutAgentResponse');
export const ListAgentsResponseSchema = z.object({ data: z.array(AgentSchema) }).openapi('ListAgentsResponse');
export const GetAgentResponseSchema = z.object({ data: AgentSchema }).openapi('GetAgentResponse');

export type AgentWriteRequest = z.infer<typeof AgentWriteRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;

/** Strip registry identity; remaining fields are the persisted AgentSpec document. */
export function toAgentManifest(request: AgentWriteRequest): AgentSpec {
  const { name, ...manifest } = request;
  void name;
  return manifest;
}
