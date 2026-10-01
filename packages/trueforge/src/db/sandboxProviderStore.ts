/**
 * DB-backed configured sandbox provider: at most one row per tenant. Persists the
 * Zod-validated `StoredSandboxProviderManifest` jsonb document.
 * Snapshot readiness lives on sandbox environment versions, not this row.
 * Implementations: PostgresSandboxProviderStore and SqliteSandboxProviderStore.
 */
import type { StoredSandboxProviderManifest } from '../schemas/sandboxProvider';

export interface SandboxProviderRecord {
  tenant_id: string;
  manifest: StoredSandboxProviderManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface UpsertSandboxProviderInput {
  tenant_id: string;
  manifest: StoredSandboxProviderManifest;
}

export interface ISandboxProviderStore<TTransaction = never> {
  getSandboxProvider(tenantId: string, transaction?: TTransaction): Promise<SandboxProviderRecord | undefined>;
  /**
   * Load the provider while holding a row lock for the lifetime of `transaction`.
   * Postgres: `SELECT … FOR UPDATE`. SQLite: plain read under a write txn (BEGIN IMMEDIATE).
   * Required before read-modify-write of secrets so concurrent keep/rotate cannot interleave.
   */
  getSandboxProviderForUpdate(tenantId: string, transaction: TTransaction): Promise<SandboxProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest. */
  upsertSandboxProvider(input: UpsertSandboxProviderInput, transaction?: TTransaction): Promise<SandboxProviderRecord>;
}
