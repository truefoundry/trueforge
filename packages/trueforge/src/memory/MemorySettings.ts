/**
 * Tenant-level memory switch. Off stops ingestion now, and retrieval and agent memory writes once
 * they exist, for that tenant.
 */
export interface MemorySettings {
  isTenantMemoryEnabled(tenantId: string): Promise<boolean>;
}

/** Memory for the tenants in `MEMORY_TENANT_ALLOWLIST` only. */
export class TenantAllowlistMemorySettings implements MemorySettings {
  readonly #tenantIds: ReadonlySet<string>;

  constructor(options: { tenantIds: readonly string[] }) {
    this.#tenantIds = new Set(options.tenantIds);
  }

  isTenantMemoryEnabled(tenantId: string): Promise<boolean> {
    return Promise.resolve(this.#tenantIds.has(tenantId));
  }
}
