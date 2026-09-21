import type { ResourceName } from '../schemas/common';
import type { WebSearchProviderManifest } from '../schemas/webSearchProvider';

export interface WebSearchProviderRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: WebSearchProviderManifest;
  created_at: string;
  updated_at: string;
}

export interface ListWebSearchProvidersInput {
  tenant_id: string;
}

export interface GetWebSearchProviderInput {
  tenant_id: string;
  name: string;
}

export interface GetWebSearchProviderForUpdateInput {
  tenant_id: string;
  name: string;
}

export interface CreateWebSearchProviderInput {
  tenant_id: string;
  name: ResourceName;
  manifest: WebSearchProviderManifest;
}

export type UpsertWebSearchProviderInput = CreateWebSearchProviderInput;

export class WebSearchProviderNameConflictError extends Error {
  readonly tenant_id: string;
  readonly provider_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Web search provider name already exists: ${name}`, options);
    this.name = 'WebSearchProviderNameConflictError';
    this.tenant_id = tenant_id;
    this.provider_name = name;
  }
}

export interface IWebSearchProviderStore<TTransaction = never> {
  listProviders(input: ListWebSearchProvidersInput, transaction?: TTransaction): Promise<WebSearchProviderRecord[]>;
  getProvider(
    input: GetWebSearchProviderInput,
    transaction?: TTransaction,
  ): Promise<WebSearchProviderRecord | undefined>;
  /** Row lock for secret keep/rotate; Postgres FOR UPDATE, SQLite write txn. */
  getProviderForUpdate(
    input: GetWebSearchProviderForUpdateInput,
    transaction: TTransaction,
  ): Promise<WebSearchProviderRecord | undefined>;
  createProvider(input: CreateWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord>;
  upsertProvider(input: UpsertWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord>;
}
