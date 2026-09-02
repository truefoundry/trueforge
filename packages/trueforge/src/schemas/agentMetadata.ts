/**
 * Agent-row metadata jsonb (internal only; not on the public Agent API).
 * Empty until keys are whitelisted here.
 */
export type AgentMetadata = Record<string, never>;

export const EMPTY_AGENT_METADATA: AgentMetadata = {};
