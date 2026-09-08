/**
 * Wire schemas for POST /api/internal/import/agents and /sessions (+ GET /checkpoint).
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

/** Loose session snapshot for ops backfill. */
export const ImportSessionRequestSchema = z
  .object({
    session: z
      .object({
        session_id: z.string().min(1),
        tenant_id: z.string().min(1),
        created_by_subject: CreatedBySubjectSchema,
        agent_name: z.string().min(1).nullable().optional(),
        agent_spec: z.record(z.string(), z.unknown()).nullable().optional(),
        title: z.string().nullable(),
        last_turn_id: z.string().nullable(),
        custom: z.record(z.string(), z.unknown()).nullable(),
        last_activity_timestamp_ms: z.number(),
        created_at: z.string().min(1),
        updated_at: z.string().min(1),
      })
      .loose(),
    turns: z
      .array(
        z
          .object({
            turn_id: z.string().min(1),
            first_turn_id: z.string().min(1),
            previous_turn_id: z.string().nullable(),
            ancestor_ids: z.array(z.string()),
            input: z.array(z.unknown()),
            state: z.unknown(),
            checkpoint: z.unknown(),
            custom: z.record(z.string(), z.unknown()).nullable(),
            created_at: z.string().min(1),
            updated_at: z.string().min(1),
            threads: z.array(
              z
                .object({
                  thread_id: z.string().min(1),
                  context: z.array(z.unknown()),
                  current_context_usage: z.unknown(),
                  parent: z.unknown().nullable(),
                  completion: z.unknown().nullable(),
                  agent_info: z.unknown().nullable(),
                  capability_state: z.record(z.string(), z.unknown()).nullable(),
                })
                .loose(),
            ),
            events: z.array(
              z
                .object({
                  id: z.string().min(1),
                  created_at: z.string().min(1),
                })
                .loose(),
            ),
          })
          .loose(),
      )
      .min(1),
  })
  .openapi('ImportSessionRequest');

export const ImportSessionResultSchema = z
  .object({
    imported: z.boolean(),
    session_id: z.string(),
  })
  .openapi('ImportSessionResult');

export const ImportSessionResponseSchema = z
  .object({ data: ImportSessionResultSchema })
  .openapi('ImportSessionResponse');

export const ImportCheckpointResponseSchema = z
  .object({
    data: z.object({
      created_at: z.string().nullable(),
    }),
  })
  .strict()
  .openapi('ImportCheckpointResponse');

export type ImportSessionRequest = z.infer<typeof ImportSessionRequestSchema>;
export type ImportSessionResult = z.infer<typeof ImportSessionResultSchema>;
