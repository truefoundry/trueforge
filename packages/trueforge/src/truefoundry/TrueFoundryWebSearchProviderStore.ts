import configuration, { isTrueFoundryModeEnabled } from '../config';
import type {
  IWebSearchProviderStore,
  UpsertWebSearchProviderInput,
  WebSearchProviderRecord,
} from '../db/webSearchProviderStore';
import { trueFoundryManaged } from './errors';

function synthesizeParallelRecord(tenantId: string): WebSearchProviderRecord | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  const env = configuration.TRUEFOUNDRY_WEB_SEARCH_PROVIDER;
  if (!env) {
    return undefined;
  }
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    manifest: {
      type: 'parallel',
      auth: { api_key: env.api_key },
    },
    created_at: now,
    updated_at: now,
  };
}

export class TrueFoundryWebSearchProviderStore<TTransaction = never> implements IWebSearchProviderStore<TTransaction> {
  getProvider(tenantId: string, transaction?: TTransaction): Promise<WebSearchProviderRecord | undefined> {
    void transaction;
    return Promise.resolve(synthesizeParallelRecord(tenantId));
  }

  upsertProvider(input: UpsertWebSearchProviderInput, transaction?: TTransaction): Promise<WebSearchProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }
}
