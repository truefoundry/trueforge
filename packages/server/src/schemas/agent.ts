/**
 * Configured agent domain + wire schemas: identity columns plus an AgentSpec
 * manifest document. AgentSpec remains owned by harness; this module only adds
 * registry identity (`id`, `name`).
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema, type AgentSpec } from '@truefoundry/utils-core/agent-session';
import { NameSchema } from './common';

/** Create body: unique immutable `name` plus full AgentSpec. `id` is never client-supplied. */
export const AgentWriteRequestSchema = AgentSpecSchema.extend({
  name: NameSchema,
}).openapi('AgentWriteRequest');

/** Update body: full AgentSpec replacement. Name is the path key and is immutable. */
export const UpdateAgentRequestSchema = AgentSpecSchema.openapi('UpdateAgentRequest');

/** List/get/create/update response item: immutable `id`, unique immutable `name`, and AgentSpec fields. */
export const AgentSchema = AgentSpecSchema.extend({
  id: z.string().min(1).describe('Immutable server-generated agent identifier.'),
  name: NameSchema.describe('Immutable unique agent name within the tenant.'),
}).openapi('Agent');

export const CreateAgentResponseSchema = z.object({ data: AgentSchema }).openapi('CreateAgentResponse');
export const PutAgentResponseSchema = z.object({ data: AgentSchema }).openapi('PutAgentResponse');
export const ListAgentsResponseSchema = z.object({ data: z.array(AgentSchema) }).openapi('ListAgentsResponse');
export const GetAgentResponseSchema = z.object({ data: AgentSchema }).openapi('GetAgentResponse');

export type AgentWriteRequest = z.infer<typeof AgentWriteRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;

/** Strip registry identity; remaining fields are the persisted AgentSpec document. */
export function toAgentManifest(request: AgentWriteRequest): AgentSpec {
  const { name, ...manifest } = request;
  void name;
  return manifest;
}
