/** Tenant-level memory switch: only these tenants' sessions are read for ingestion. */
export interface MemorySettings {
  listEnabledTenantIds(): Promise<readonly string[]>;
}

/** Memory for the tenants in `MEMORY_TENANT_ALLOWLIST` only. */
export class TenantAllowlistMemorySettings implements MemorySettings {
  readonly #tenantIds: readonly string[];

  constructor(options: { tenantIds: readonly string[] }) {
    this.#tenantIds = [...new Set(options.tenantIds)];
  }

  listEnabledTenantIds(): Promise<readonly string[]> {
    return Promise.resolve(this.#tenantIds);
  }
}
