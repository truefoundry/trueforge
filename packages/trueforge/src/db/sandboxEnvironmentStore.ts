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
  /** Env var → Daytona org secret name (from getEnvironment). */
  mounted_secrets?: Record<string, string>;
}

/** Secret row (Daytona refs; no plaintext). */
export interface SandboxEnvironmentSecretRecord {
  id: string;
  tenant_id: string;
  environment_id: string;
  secret_name: string;
  external_secret_name: string;
  external_secret_id: string;
  description: string;
  hash: string;
  created_at: string;
  updated_at: string;
}

export interface SyncedSandboxEnvironmentSecret {
  secret_name: string;
  external_secret_name: string;
  external_secret_id: string;
}

export function parseStoredSandboxEnvironmentManifest(manifest: unknown): StoredSandboxEnvironmentManifest {
  return StoredSandboxEnvironmentManifestSchema.parse(manifest);
}

export interface ListSandboxEnvironmentsInput {
  tenant_id: string;
  /** Only environments created by this subject (tenant `"default"` is always included). */
  created_by_subject_id: string;
  limit: number | undefined;
  page_token: string | undefined;
}

export interface GetSandboxEnvironmentInput {
  tenant_id: string;
  name: string;
  /**
   * When set (CRUD / agent attach), only return if this subject created the environment.
   * Ignored for the tenant `"default"`. Omit when resolving an env during agent execution.
   */
  created_by_subject_id?: string;
}

/** Version + parent fields needed to progress a build. */
export interface SandboxEnvironmentVersionForProgress {
  id: string;
  tenant_id: string;
  environment_id: string;
  environment_name: string;
  version: number;
  external_ref: string;
  manifest: StoredSandboxEnvironmentManifest;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
}

export interface GetSandboxEnvironmentVersionInput {
  environment_version_id: string;
}

/**
 * Result of `buildVersion` during upsert — {@link NextSandboxEnvironmentVersion} plus subject.
 */
export type UpsertSandboxEnvironmentVersion = NextSandboxEnvironmentVersion & {
  created_by_subject: CreatedBySubject;
};

/** Complete version row fields after the store resolves secret-row references. */
export type UpsertSandboxEnvironmentVersionWrite = UpsertSandboxEnvironmentVersion & {
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
};

/** Args for `buildVersion` during upsert. Tip fields omitted on first create. */
export interface ExistingSandboxEnvironmentVersion {
  environment_id: string;
  existing_version?: number;
  existing_manifest?: StoredSandboxEnvironmentManifest;
  existing_external_ref?: string;
}

export interface UpsertSandboxEnvironmentInput {
  tenant_id: string;
  name: ResourceName;
  description: string;
  created_by_subject: CreatedBySubject;
  /** Complete provider refs from a successful secret sync before upsert. */
  synced_secrets: SyncedSandboxEnvironmentSecret[];
  /** Called after parent lock/create; store upserts secrets from the returned manifest. */
  buildVersion: (input: ExistingSandboxEnvironmentVersion) => Promise<UpsertSandboxEnvironmentVersion>;
}

export interface MarkSandboxEnvironmentVersionReadyInput {
  environment_version_id: string;
}

export interface MarkSandboxEnvironmentVersionFailedInput {
  environment_version_id: string;
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
  /** Active environments joined to `active_version` (includes tenant `"default"`). */
  listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }>;
  /**
   * Active environment by name, joined to its latest version for management APIs.
   * Pass `created_by_subject_id` for owner-scoped CRUD/attach on custom envs; the tenant
   * `"default"` ignores ownership.
   */
  getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  /** Active environment by name, joined to the version currently used for sandbox creation. */
  getActiveEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  /**
   * Create or replace by `(tenant_id, name)` — parent + version row.
   * Updates insert a new version; parent `active_version` advances only when status is
   * `ready` (otherwise use markVersionReady). Uses `transaction` when passed; otherwise
   * opens its own.
   */
  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion>;
  /** Latest pending version id per environment across tenants (oldest first). */
  listLatestPendingVersions(transaction?: TTransaction): Promise<string[]>;
  /** Version row + parent fields for controller progress. */
  getSandboxEnvironmentVersion(
    input: GetSandboxEnvironmentVersionInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionForProgress | undefined>;
  /**
   * Set version status to `ready` and point the parent `active_version` at it when
   * `version >= active_version`. No-op (returns undefined) if the version row is missing.
   */
  markVersionReady(
    input: MarkSandboxEnvironmentVersionReadyInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionRecord | undefined>;
  /** Soft-delete: set lifecycle_stage = deleted. Idempotent if missing or already deleted. */
  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void>;
  listSecretsByEnvironment(
    input: { environment_id: string },
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentSecretRecord[]>;
}
