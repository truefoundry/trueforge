/**
 * DB-backed sandbox environments: parent row + immutable version rows.
 * Implementations: PostgresSandboxEnvironmentStore and SqliteSandboxEnvironmentStore.
 */
import type { CreatedBySubject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { NextSandboxEnvironmentVersion } from '../sandbox/sandboxEnvironmentVersion';
import type { ResourceName } from '../schemas/common';
import type {
  SandboxEnvironmentLifecycleStage,
  SandboxEnvironmentVersionInternalMetadata,
  SandboxEnvironmentVersionStatus,
  StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { StoredSandboxEnvironmentManifestSchema } from '../schemas/sandboxEnvironment';

export interface SandboxEnvironmentRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  description: string;
  active_version: number;
  lifecycle_stage: SandboxEnvironmentLifecycleStage;
  created_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface SandboxEnvironmentVersionRecord {
  id: string;
  environment_id: string;
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionStatus;
  status_reason: string | null;
  external_ref: string;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
  created_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

/** Parent + its active version row (list/get join). */
export interface SandboxEnvironmentWithVersion {
  environment: SandboxEnvironmentRecord;
  version: SandboxEnvironmentVersionRecord;
}

export function parseStoredSandboxEnvironmentManifest(manifest: unknown): StoredSandboxEnvironmentManifest {
  return StoredSandboxEnvironmentManifestSchema.parse(manifest);
}

export interface ListSandboxEnvironmentsInput {
  tenant_id: string;
  /** Only environments created by this subject. */
  created_by_subject_id: string;
  limit: number | undefined;
  page_token: string | undefined;
}

export interface GetSandboxEnvironmentInput {
  tenant_id: string;
  name: string;
  /**
   * When set (CRUD / agent attach), only return if this subject created the environment.
   * Omit when resolving an env during agent execution: running the agent already
   * implies access to its referenced sandbox environment, so ownership is not checked.
   */
  created_by_subject_id?: string;
}

/**
 * Result of `buildVersion` during upsert — {@link NextSandboxEnvironmentVersion} plus subject.
 */
export type UpsertSandboxEnvironmentVersion = NextSandboxEnvironmentVersion & {
  created_by_subject: CreatedBySubject;
};

/** Version row columns for insert (store fills `environment_id`). */
export type UpsertSandboxEnvironmentVersionWrite = UpsertSandboxEnvironmentVersion;

export function toUpsertSandboxEnvironmentVersionWrite(
  built: UpsertSandboxEnvironmentVersion,
): UpsertSandboxEnvironmentVersionWrite {
  return built;
}

/** Latest version row when updating; omitted on first create. Used for numbering + secret/diff. */
export interface UpsertSandboxEnvironmentPrevious {
  latest_version: number;
  previous_manifest: StoredSandboxEnvironmentManifest;
  previous_external_ref: string;
}

export interface UpsertSandboxEnvironmentInput {
  tenant_id: string;
  name: ResourceName;
  description: string;
  created_by_subject: CreatedBySubject;
  /**
   * Called inside the write transaction. `previous` is set when updating an existing
   * env (after the parent row is locked / re-read) so concurrent PUTs cannot collide
   * on the next version number.
   */
  buildVersion: (previous?: UpsertSandboxEnvironmentPrevious) => UpsertSandboxEnvironmentVersion;
}

export interface MarkSandboxEnvironmentVersionActiveInput {
  environment_id: string;
  version: number;
}

export interface MarkSandboxEnvironmentVersionFailedInput {
  environment_id: string;
  version: number;
  status_reason: string;
}

export interface DeleteSandboxEnvironmentInput {
  tenant_id: string;
  name: string;
  /** Soft-delete only if created by this subject. */
  created_by_subject_id: string;
}

/** Partial unique `(tenant_id, name) WHERE lifecycle_stage = 'active'` violation. */
export class SandboxEnvironmentNameConflictError extends Error {
  readonly tenant_id: string;
  readonly environment_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Sandbox environment name already exists: ${name}`, options);
    this.name = 'SandboxEnvironmentNameConflictError';
    this.tenant_id = tenant_id;
    this.environment_name = name;
  }
}

/** Unique `(environment_id, version)` violation from concurrent updates. */
export class SandboxEnvironmentVersionConflictError extends Error {
  readonly environment_id: string;
  readonly version: number;

  constructor({ environment_id, version }: { environment_id: string; version: number }, options?: ErrorOptions) {
    super(`Sandbox environment version conflict: ${environment_id}@${String(version)}`, options);
    this.name = 'SandboxEnvironmentVersionConflictError';
    this.environment_id = environment_id;
    this.version = version;
  }
}

export interface ISandboxEnvironmentStore<TTransaction = never> {
  /** Active environments joined to the version pointed at by `active_version`. */
  listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }>;
  /**
   * Active environment by name, joined to its active version.
   * Pass `created_by_subject_id` for owner-scoped CRUD/attach; omit it when an agent
   * run resolves the env by name (caller already has access via the agent).
   */
  getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  /**
   * Create or replace by `(tenant_id, name)` for this subject — parent + new version row.
   * On update, parent `active_version` advances only when the new version's status is
   * `active` (otherwise use markVersionActive). Uses `transaction` when passed;
   * otherwise opens its own (multi-write).
   */
  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion>;
  /**
   * Set version status to `active` and point the parent `active_version` at it.
   * No-op (returns undefined) if the version row is missing.
   */
  markVersionActive(
    input: MarkSandboxEnvironmentVersionActiveInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionRecord | undefined>;
  /** Soft-delete: set lifecycle_stage = deleted. Idempotent if missing or already deleted. */
  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void>;
}
