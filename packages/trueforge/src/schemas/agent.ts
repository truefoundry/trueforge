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

export const AgentCodeSnippetSampleCodeSchema = z
  .object({
    stream: z.string().describe('SDK sample that streams turn events.'),
    non_stream: z.string().describe('SDK sample that creates a turn without streaming.'),
  })
  .strict();

export const AgentCodeSnippetSchema = z
  .object({
    label_name: z.string().min(1),
    language: z.string().min(1),
    icon: z.url(),
    sample_code: AgentCodeSnippetSampleCodeSchema,
  })
  .strict();

export const AgentCodeSnippetsSchema = z
  .object({
    base_url: z.url().describe('Origin to pass as the TrueForge SDK `baseUrl`.'),
    snippets: z.array(AgentCodeSnippetSchema),
  })
  .strict();

export const GetAgentCodeSnippetsResponseSchema = z.object({ data: AgentCodeSnippetsSchema });

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentCodeSnippets = z.infer<typeof AgentCodeSnippetsSchema>;
