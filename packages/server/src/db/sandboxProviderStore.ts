/**
 * DB-backed configured sandbox provider: at most one row per tenant. Persists the
 * Zod-validated `SandboxProviderManifest` jsonb document plus the last-known build
 * status (`status` / `status_reason` / `build_metadata`), refreshed on read.
 * Implementations: PostgresSandboxProviderStore and SqliteSandboxProviderStore.
 */
import type { SandboxBuildMetadata, SandboxBuildStatus, SandboxProviderManifest } from '../schemas/sandboxProvider';

export interface SandboxProviderRecord {
  tenant_id: string;
  manifest: SandboxProviderManifest;
  /** Last persisted build status of the release sandbox image. */
  status: SandboxBuildStatus;
  /** Human-readable detail for `status`; null when ready. */
  status_reason: string | null;
  /** Provider-specific build metadata; null when the provider has none. */
  build_metadata: SandboxBuildMetadata | null;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface UpsertSandboxProviderInput {
  tenant_id: string;
  manifest: SandboxProviderManifest;
  status: SandboxBuildStatus;
  status_reason: string | null;
  build_metadata: SandboxBuildMetadata | null;
}

export interface UpdateSandboxStatusInput {
  tenant_id: string;
  status: SandboxBuildStatus;
  status_reason: string | null;
  build_metadata: SandboxBuildMetadata | null;
}

export interface ISandboxProviderStore<TTransaction = never> {
  getSandboxProvider(tenantId: string, transaction?: TTransaction): Promise<SandboxProviderRecord | undefined>;
  /**
   * Load the provider while holding a row lock for the lifetime of `transaction`.
   * Postgres: `SELECT … FOR UPDATE`. SQLite: plain read under a write txn (BEGIN IMMEDIATE).
   * Required before read-modify-write of secrets so concurrent keep/rotate cannot interleave.
   */
  getSandboxProviderForUpdate(tenantId: string, transaction: TTransaction): Promise<SandboxProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest + build status. */
  upsertSandboxProvider(input: UpsertSandboxProviderInput, transaction?: TTransaction): Promise<SandboxProviderRecord>;
  /**
   * Refresh only the build status columns (status / status_reason / build_metadata) of the
   * existing row, leaving the manifest untouched. Returns undefined when no row exists.
   */
  updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: TTransaction,
  ): Promise<SandboxProviderRecord | undefined>;
}
