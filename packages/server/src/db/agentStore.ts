/**
 * DB-backed configured agents: one row per agent per tenant,
 * immutable ULID `id`, unique mutable `name` within a tenant, plus a Zod-validated
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

export interface GetAgentByIdInput {
  tenant_id: string;
  id: string;
}

export interface GetAgentByNameInput {
  tenant_id: string;
  name: string;
}

export interface CreateAgentInput {
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
}

export interface UpdateAgentInput {
  tenant_id: string;
  id: string;
  name: ResourceName;
  manifest: AgentSpec;
}

/** Unique `(tenant_id, name)` violation on create or rename. */
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
  getAgentById(input: GetAgentByIdInput): Promise<AgentRecord | undefined>;
  getAgentByName(input: GetAgentByNameInput): Promise<AgentRecord | undefined>;
  /** Inserts a new agent with a generated ULID. Throws AgentNameConflictError on name clash. */
  createAgent(input: CreateAgentInput): Promise<AgentRecord>;
  /**
   * Replaces `name` + `manifest` for an existing id. Returns undefined if missing.
   * Throws AgentNameConflictError if the new name is taken by another agent.
   */
  updateAgent(input: UpdateAgentInput): Promise<AgentRecord | undefined>;
}
