/** Legacy session wire schemas — YAML sessions with LegacyAgentSpec. */
import { z } from '@hono/zod-openapi';
import { LegacyAgentSpecSchema } from './legacyAgentSpec';

export const LegacySessionSchema = z
  .object({
    id: z.string(),
    agent_spec: LegacyAgentSpecSchema,
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('LegacySession');

export const LegacyCreateSessionRequestSchema = z
  .object({
    agent_spec: LegacyAgentSpecSchema,
  })
  .openapi('LegacyCreateSessionRequest');

export const LegacyUpdateSessionRequestSchema = z
  .object({
    agent_spec: LegacyAgentSpecSchema.optional(),
  })
  .openapi('LegacyUpdateSessionRequest');

export type LegacySession = z.infer<typeof LegacySessionSchema>;
