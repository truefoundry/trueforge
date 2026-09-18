/**
 * DB-backed sandbox environments: owned per creator within a tenant.
 * Immutable ULID `id`, unique `name` within a tenant, Zod-validated manifest jsonb.
 * Implementations: PostgresSandboxEnvironmentStore and SqliteSandboxEnvironmentStore.
 */
import type { CreatedBySubject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { ResourceName } from '../schemas/common';
import {
  StoredSandboxEnvironmentManifestSchema,
  type StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';

/** Re-parse persisted manifest JSON so schema defaults materialize for older rows. */
export function parseStoredSandboxEnvironmentManifest(manifest: unknown): StoredSandboxEnvironmentManifest {
  return StoredSandboxEnvironmentManifestSchema.parse(manifest);
}

export interface SandboxEnvironmentRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  description: string | null;
  manifest: StoredSandboxEnvironmentManifest;
  created_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export type GetSandboxEnvironmentInput = { tenant_id: string } & ({ id: string } | { name: string });

export interface ListSandboxEnvironmentsInput {
  tenant_id: string;
  created_by_subject_id: string;
  limit: number;
  page_token: string | undefined;
}

export interface GetOwnedIdsInput {
  tenant_id: string;
  ids: readonly string[];
  subject_id: string;
}

export interface CreateSandboxEnvironmentInput {
  tenant_id: string;
  name: ResourceName;
  description: string | null;
  manifest: StoredSandboxEnvironmentManifest;
  created_by_subject: CreatedBySubject;
}

export interface UpdateSandboxEnvironmentInput {
  tenant_id: string;
  id: string;
  description: string | null | undefined;
  manifest: StoredSandboxEnvironmentManifest;
}

export interface DeleteSandboxEnvironmentInput {
  tenant_id: string;
  id: string;
}

export class SandboxEnvironmentNameConflictError extends Error {
  readonly tenant_id: string;
  readonly conflict_name: string;

  constructor(input: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Sandbox environment name "${input.name}" already exists`, options);
    this.name = 'SandboxEnvironmentNameConflictError';
    this.tenant_id = input.tenant_id;
    this.conflict_name = input.name;
  }
}

export interface ISandboxEnvironmentStore<TTransaction = never> {
  createSandboxEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentRecord>;
  getSandboxEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentRecord | undefined>;
  listSandboxEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentRecord[]; pagination: TokenPagination }>;
  updateSandboxEnvironment(
    input: UpdateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentRecord | undefined>;
  deleteSandboxEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<boolean>;
  getOwnedIds(input: GetOwnedIdsInput, transaction?: TTransaction): Promise<readonly string[]>;
}
