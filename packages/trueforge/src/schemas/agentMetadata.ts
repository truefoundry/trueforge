/**
 * Agent-row metadata jsonb with a strict whitelist (empty until keys are added).
 */
import { z } from '@hono/zod-openapi';

/** `agent.metadata` jsonb; unknown keys are rejected until whitelisted. */
export const AgentMetadataSchema = z.object({}).strict().openapi('AgentMetadata');

export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;

export const EMPTY_AGENT_METADATA: AgentMetadata = {};
