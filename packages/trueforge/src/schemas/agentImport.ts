/**
 * Wire schemas for POST /api/internal/import/agents (bulk ops backfill).
 */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema } from '@truefoundry/trueforge-core/agent-session';
import { CreateAgentRequestSchema } from './agent';

/** One import row: create body plus explicit tenant and creator (not taken from the bearer). */
export const ImportAgentItemSchema = CreateAgentRequestSchema.extend({
  tenant_id: z.string().min(1).describe('Tenant to create the agent under.'),
  created_by_subject: CreatedBySubjectSchema.describe('Original creator to persist on the agent.'),
}).openapi('ImportAgentItem');

export const ImportAgentsRequestSchema = z
  .object({
    agents: z
      .array(ImportAgentItemSchema)
      .min(1)
      .describe('Agents to create; each carries tenant_id and created_by_subject.'),
  })
  .strict()
  .openapi('ImportAgentsRequest');

export const ImportAgentItemResultSchema = z
  .object({
    name: z.string().min(1),
    tenant_id: z.string().min(1),
    status: z.enum(['created', 'exists', 'failed']),
    agent_id: z.string().min(1).optional(),
    error: z.string().optional(),
  })
  .strict()
  .openapi('ImportAgentItemResult');

export const ImportAgentsResultSchema = z
  .object({
    results: z.array(ImportAgentItemResultSchema),
  })
  .strict()
  .openapi('ImportAgentsResult');

export const ImportAgentsResponseSchema = z
  .object({
    data: ImportAgentsResultSchema,
  })
  .strict()
  .openapi('ImportAgentsResponse');

export type ImportAgentItem = z.infer<typeof ImportAgentItemSchema>;
export type ImportAgentsRequest = z.infer<typeof ImportAgentsRequestSchema>;
export type ImportAgentItemResult = z.infer<typeof ImportAgentItemResultSchema>;
export type ImportAgentsResponse = z.infer<typeof ImportAgentsResponseSchema>;
