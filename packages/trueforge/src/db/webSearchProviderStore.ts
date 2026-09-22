import type { WebSearchProviderManifest } from '../schemas/webSearchProvider';

export interface WebSearchProviderRecord {
  tenant_id: string;
  manifest: WebSearchProviderManifest;
  created_at: string;
  updated_at: string;
}

export interface UpsertWebSearchProviderInput {
  tenant_id: string;
  manifest: WebSearchProviderManifest;
}

export interface IWebSearchProviderStore<TTransaction = never> {
  getProvider(tenantId: string, transaction?: TTransaction): Promise<WebSearchProviderRecord | undefined>;
  /** Single-row write: creates the provider or replaces the whole manifest. */
  upsertProvider(input: UpsertWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord>;
}
