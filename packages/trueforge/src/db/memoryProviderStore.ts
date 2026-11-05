import type { MemoryProviderManifest } from '../schemas/memoryProvider';

export interface MemoryProviderRecord {
  tenant_id: string;
  manifest: MemoryProviderManifest;
  created_at: string;
  updated_at: string;
}

export interface UpsertMemoryProviderInput {
  tenant_id: string;
  manifest: MemoryProviderManifest;
}

export interface IMemoryProviderStore<TTransaction = never> {
  getProvider(tenantId: string, transaction?: TTransaction): Promise<MemoryProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest. */
  upsertProvider(input: UpsertMemoryProviderInput, transaction?: TTransaction): Promise<MemoryProviderRecord>;
}
