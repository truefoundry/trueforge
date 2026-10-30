/**
 * Tenant-level memory switch. Off stops ingestion now, and retrieval and agent memory writes once
 * they exist, for that tenant.
 */
export interface MemorySettings {
  isTenantMemoryEnabled(tenantId: string): Promise<boolean>;
}

/**
 * Placeholder until tenant settings land: the global `MEMORY_ENABLED` flag plus an optional tenant
 * allowlist (empty allows every tenant).
 */
export class FlagMemorySettings implements MemorySettings {
  readonly #enabled: boolean;
  readonly #tenantAllowlist: ReadonlySet<string>;

  constructor(options: { enabled: boolean; tenantAllowlist: readonly string[] }) {
    this.#enabled = options.enabled;
    this.#tenantAllowlist = new Set(options.tenantAllowlist);
  }

  isTenantMemoryEnabled(tenantId: string): Promise<boolean> {
    // TODO(tenant_setting): read tenant_setting.manifest.memory.enabled once that table exists.
    return Promise.resolve(this.#enabled && (this.#tenantAllowlist.size === 0 || this.#tenantAllowlist.has(tenantId)));
  }
}
