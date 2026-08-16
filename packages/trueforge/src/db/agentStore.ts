/**
 * DB-backed configured agents: one row per agent per tenant,
 * immutable ULID `id`, unique immutable `name` within a tenant, plus a Zod-validated
 * `AgentSpec` jsonb document.
 * Implementations: PostgresAgentStore and SqliteAgentStore.
 */
import { AgentSpecSchema, type AgentSpec } from '@truefoundry/trueforge-core/agent-session';
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

/**
 * Re-parse persisted manifest JSON so schema defaults (e.g. nested `config`) materialize.
 * Rows written before a config field existed omit it on disk; readers must not assume presence.
 */
export function parseStoredAgentSpec(manifest: unknown): AgentSpec {
  return AgentSpecSchema.parse(manifest);
}

/** Look up by immutable id or unique name within a tenant. */
export type GetAgentInput = { tenant_id: string } & ({ id: string } | { name: string });

export interface CreateAgentInput {
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
}

/** Replace manifest for an existing agent keyed by immutable id. */
export interface UpdateAgentInput {
  tenant_id: string;
  id: string;
  manifest: AgentSpec;
}

export interface DeleteAgentInput {
  tenant_id: string;
  id: string;
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

export interface IAgentStore<TTransaction = never> {
  listAgents(tenantId: string, transaction?: TTransaction): Promise<AgentRecord[]>;
  getAgent(input: GetAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined>;
  /** Inserts a new agent with a generated ULID. Throws AgentNameConflictError on name clash. */
  createAgent(input: CreateAgentInput, transaction?: TTransaction): Promise<AgentRecord>;
  /** Replaces `manifest` for an existing id. Returns undefined if missing. */
  updateAgent(input: UpdateAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined>;
  /** Deletes by immutable id. Idempotent if already missing. */
  deleteAgent(input: DeleteAgentInput, transaction?: TTransaction): Promise<void>;
}
