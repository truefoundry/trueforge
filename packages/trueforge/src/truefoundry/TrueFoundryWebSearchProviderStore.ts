import configuration, { isTrueFoundryModeEnabled } from '../config';
import type {
  CreateWebSearchProviderInput,
  GetWebSearchProviderForUpdateInput,
  GetWebSearchProviderInput,
  IWebSearchProviderStore,
  ListWebSearchProvidersInput,
  UpsertWebSearchProviderInput,
  WebSearchProviderRecord,
} from '../db/webSearchProviderStore';
import { webSearchProviderName } from '../schemas/webSearchProvider';
import { trueFoundryManaged } from './errors';

function synthesizeParallelRecord(tenantId: string): WebSearchProviderRecord | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  const env = configuration.TRUEFOUNDRY_WEB_SEARCH_PROVIDER;
  if (!env) {
    return undefined;
  }
  const manifest = {
    type: 'parallel' as const,
    auth: { api_key: env.api_key },
    mode: 'turbo' as const,
  };
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    name: webSearchProviderName(manifest),
    manifest,
    created_at: now,
    updated_at: now,
  };
}

export class TrueFoundryWebSearchProviderStore<TTransaction = never> implements IWebSearchProviderStore<TTransaction> {
  listProviders(input: ListWebSearchProvidersInput, transaction?: TTransaction): Promise<WebSearchProviderRecord[]> {
    void transaction;
    const record = synthesizeParallelRecord(input.tenant_id);
    return Promise.resolve(record ? [record] : []);
  }

  getProvider(
    input: GetWebSearchProviderInput,
    transaction?: TTransaction,
  ): Promise<WebSearchProviderRecord | undefined> {
    void transaction;
    const record = synthesizeParallelRecord(input.tenant_id);
    if (record?.name !== input.name) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(record);
  }

  getProviderForUpdate(
    input: GetWebSearchProviderForUpdateInput,
    transaction: TTransaction,
  ): Promise<WebSearchProviderRecord | undefined> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  createProvider(input: CreateWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  upsertProvider(input: UpsertWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }
}
