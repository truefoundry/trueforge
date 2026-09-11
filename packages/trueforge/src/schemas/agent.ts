/**
 * Configured agent domain + wire schemas: identity columns plus a nested
 * AgentSpec document (JSON key `manifest`).
 */
import { z } from '@hono/zod-openapi';
import {
  AgentSpecSchema,
  CreatedBySubjectSchema,
  TokenPaginationSchema,
} from '@truefoundry/trueforge-core/agent-session';
import { NameSchema } from './common';

const RESERVED_AGENT_NAMES = new Set(['tfg', 'trueforge']);

export const AGENT_DESCRIPTION_MAX_LENGTH = 1024;

export const AgentDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_DESCRIPTION_MAX_LENGTH)
  .describe('Short summary of what the agent does.');

/** Create body: unique immutable `name` plus manifest. `id` is never client-supplied. */
export const CreateAgentRequestSchema = z
  .object({
    name: NameSchema.refine(name => !RESERVED_AGENT_NAMES.has(name), {
      message: 'Agent name is reserved, cannot be used',
    }),
    description: AgentDescriptionSchema,
    manifest: AgentSpecSchema,
  })
  .strict()
  .openapi('CreateAgentRequest');

/** PUT body: full manifest replacement; `description` optional. */
export const UpdateAgentRequestSchema = z
  .object({
    description: AgentDescriptionSchema.optional(),
    manifest: AgentSpecSchema,
  })
  .strict()
  .openapi('UpdateAgentRequest');

/** List/get/create/update response item: identity columns plus nested manifest. */
export const AgentSchema = z
  .object({
    id: z.string().min(1).describe('Immutable server-generated agent identifier.'),
    name: NameSchema,
    description: AgentDescriptionSchema,
    manifest: AgentSpecSchema,
    created_by_subject: CreatedBySubjectSchema,
  })
  .strict()
  .openapi('Agent');
export const GetAgentResponseSchema = z.object({ data: AgentSchema }).openapi('GetAgentResponse');
export const ListAgentsResponseSchema = z
  .object({
    data: z.array(AgentSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListAgentsResponse');
export const DeleteAgentResponseSchema = z.object({}).openapi('DeleteAgentResponse');

export const AgentCodeSnippetSampleCodeSchema = z
  .object({
    stream: z.string().describe('SDK sample that streams turn events.'),
    non_stream: z.string().describe('SDK sample that creates a turn without streaming.'),
  })
  .strict()
  .openapi('AgentCodeSnippetSampleCode');

export const AgentCodeSnippetSchema = z
  .object({
    label_name: z.string().min(1),
    language: z.string().min(1),
    icon: z.url(),
    sample_code: AgentCodeSnippetSampleCodeSchema,
  })
  .strict()
  .openapi('AgentCodeSnippet');

export const AgentCodeSnippetsSchema = z
  .object({
    base_url: z.url().describe('Public base URL for the TrueForge SDK `baseUrl`.'),
    snippets: z.array(AgentCodeSnippetSchema),
  })
  .strict()
  .openapi('AgentCodeSnippets');

export const GetAgentCodeSnippetsResponseSchema = z
  .object({ data: AgentCodeSnippetsSchema })
  .openapi('GetAgentCodeSnippetsResponse');

export const GetAgentCodeSnippetsRequestQuerySchema = z
  .object({
    base_url: z
      .url()
      .optional()
      .describe(
        'Public SDK base URL from the browser. When omitted, derived from the request origin and PUBLIC_BASE_URL.',
      ),
  })
  .strict()
  .openapi('GetAgentCodeSnippetsRequestQuery');

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentCodeSnippets = z.infer<typeof AgentCodeSnippetsSchema>;
export type GetAgentCodeSnippetsRequestQuery = z.infer<typeof GetAgentCodeSnippetsRequestQuerySchema>;
