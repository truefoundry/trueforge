/**
 * DB-backed configured agents: one row per agent per tenant,
 * immutable ULID `id`, unique immutable `name` within a tenant, plus a Zod-validated
 * `AgentSpec` jsonb document.
 * Implementations: PostgresAgentStore and SqliteAgentStore.
 */
import { AgentSpecSchema, type AgentSpec, type CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ResourceName } from '../schemas/common';

export interface AgentRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
  external_id: string | null;
  created_by_subject: CreatedBySubject;
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

export interface ListAgentsInput {
  tenant_id: string;
  /** When set, only agents whose `external_id` is in this list. */
  external_ids?: readonly string[];
}

export interface GetOwnedIdsInput {
  tenant_id: string;
  ids: readonly string[];
  subject_id: string;
}

export interface GetExternalIdsByIdsInput {
  tenant_id: string;
  ids: readonly string[];
}

export interface AgentExternalIdRow {
  id: string;
  external_id: string;
}

export interface CreateAgentInput {
  tenant_id: string;
  name: ResourceName;
  manifest: AgentSpec;
  external_id: string | null;
  created_by_subject: CreatedBySubject;
}

/**
 * Patch an existing agent by immutable id. At least one of `manifest` or `external_id` is required.
 * Provided fields replace the stored column; omitted fields are left unchanged.
 */
export interface UpdateAgentInput {
  tenant_id: string;
  id: string;
  manifest?: AgentSpec;
  external_id?: string | null;
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

/** Unique `(tenant_id, external_id)` violation when `external_id` is set. */
export class AgentExternalIdConflictError extends Error {
  readonly tenant_id: string;
  readonly external_id: string;

  constructor({ tenant_id, external_id }: { tenant_id: string; external_id: string }, options?: ErrorOptions) {
    super(`Agent already exists for external id: ${external_id}`, options);
    this.name = 'AgentExternalIdConflictError';
    this.tenant_id = tenant_id;
    this.external_id = external_id;
  }
}

export interface IAgentStore<TTransaction = never> {
  listAgents(input: ListAgentsInput, transaction?: TTransaction): Promise<AgentRecord[]>;
  /** Ids among `ids` owned by `subject_id`. Empty `ids` → `[]`. */
  getOwnedIds(input: GetOwnedIdsInput, transaction?: TTransaction): Promise<readonly string[]>;
  /** Agents with a non-null `external_id` among `ids`. Empty `ids` → `[]`. */
  getExternalIdsByIds(
    input: GetExternalIdsByIdsInput,
    transaction?: TTransaction,
  ): Promise<readonly AgentExternalIdRow[]>;
  getAgent(input: GetAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined>;
  /** Inserts a new agent with a generated ULID. Throws AgentNameConflictError or AgentExternalIdConflictError on unique clash. */
  createAgent(input: CreateAgentInput, transaction?: TTransaction): Promise<AgentRecord>;
  /** Patches `manifest` and/or `external_id`. Throws AgentExternalIdConflictError on unique clash. Returns undefined if missing. */
  updateAgent(input: UpdateAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined>;
  /** Deletes by immutable id. Idempotent if already missing. */
  deleteAgent(input: DeleteAgentInput, transaction?: TTransaction): Promise<void>;
}
