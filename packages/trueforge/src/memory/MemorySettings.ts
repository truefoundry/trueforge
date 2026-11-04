/** Tenant-level memory switch: which tenants' sessions are read for ingestion. */
export interface MemorySettings {
  /** Tenants with memory on; undefined means every tenant. */
  listEnabledTenantIds(): Promise<readonly string[] | undefined>;
}

/** Whether `tenantId` has memory under these settings. */
export async function isTenantMemoryEnabled(settings: MemorySettings, tenantId: string): Promise<boolean> {
  const tenantIds = await settings.listEnabledTenantIds();
  return tenantIds === undefined || tenantIds.includes(tenantId);
}

/** `TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST`: only the listed tenants, or every tenant when it is empty. */
export class TenantAllowlistMemorySettings implements MemorySettings {
  readonly #tenantIds: readonly string[] | undefined;

  constructor(options: { tenantIds: readonly string[] }) {
    this.#tenantIds = options.tenantIds.length === 0 ? undefined : [...new Set(options.tenantIds)];
  }

  listEnabledTenantIds(): Promise<readonly string[] | undefined> {
    return Promise.resolve(this.#tenantIds);
  }
}
