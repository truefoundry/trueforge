/**
 * DB-backed configured sandbox provider: at most one row per tenant,
 * Zod-validated `SandboxProviderManifest` jsonb document.
 * Implementations: PostgresSandboxProviderStore and SqliteSandboxProviderStore.
 */
import type { SandboxProviderManifest } from '../schemas/sandboxProvider';

export interface SandboxProviderRecord {
  tenant_id: string;
  manifest: SandboxProviderManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface UpsertSandboxProviderInput {
  tenant_id: string;
  manifest: SandboxProviderManifest;
}

export interface ISandboxProviderStore {
  getSandboxProvider(tenantId: string): Promise<SandboxProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest. */
  upsertSandboxProvider(input: UpsertSandboxProviderInput): Promise<SandboxProviderRecord>;
}
