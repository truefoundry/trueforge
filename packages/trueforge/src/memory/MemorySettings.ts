/**
 * Tenant-level memory switch. Off stops ingestion now, and retrieval and agent memory writes once
 * they exist, for that tenant.
 */
export interface MemorySettings {
  isTenantMemoryEnabled(tenantId: string): Promise<boolean>;
}

/** Placeholder until tenant settings land: every tenant follows the global `MEMORY_ENABLED` flag. */
export class FlagMemorySettings implements MemorySettings {
  readonly #enabled: boolean;

  constructor(options: { enabled: boolean }) {
    this.#enabled = options.enabled;
  }

  isTenantMemoryEnabled(): Promise<boolean> {
    // TODO(tenant_setting): read tenant_setting.manifest.memory.enabled once that table exists.
    return Promise.resolve(this.#enabled);
  }
}
