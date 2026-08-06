/**
 * DB-backed configured agents: one row per agent per tenant,
 * immutable ULID `id`, unique immutable `name` within a tenant, plus a Zod-validated
 * `AgentSpec` jsonb document.
 * Implementations: PostgresAgentStore and SqliteAgentStore.
 */
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import type { ResourceName } from '../schemas/common';

export interface AgentRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

/** Look up by immutable id or unique name within a tenant. */
export type GetAgentInput = { tenant_id: string } & ({ id: string } | { name: string });

export interface CreateAgentInput {
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
}

/** Replace manifest for an existing agent keyed by immutable name. */
export interface UpdateAgentInput {
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
}

/** Unique `(tenant_id, name)` violation on create. */
export class AgentNameConflictError extends Error {
  readonly tenant_id: string;
  readonly agent_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Agent name already exists: ${name}`, options);
    this.name = 'AgentNameConflictError';
    this.tenant_id = tenant_id;
    this.agent_name = name;
  }
}

export interface IAgentStore {
  listAgents(tenantId: string): Promise<AgentRecord[]>;
  getAgent(input: GetAgentInput): Promise<AgentRecord | undefined>;
  /** Inserts a new agent with a generated ULID. Throws AgentNameConflictError on name clash. */
  createAgent(input: CreateAgentInput): Promise<AgentRecord>;
  /** Replaces `manifest` for an existing name. Returns undefined if missing. */
  updateAgent(input: UpdateAgentInput): Promise<AgentRecord | undefined>;
}
