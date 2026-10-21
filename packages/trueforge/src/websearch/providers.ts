import {
  ParallelWebSearchProvider,
  type IWebSearchProvider,
  type OperationMetrics,
} from '@truefoundry/trueforge-core/core';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';

export async function hasConfiguredWebSearchProvider({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IWebSearchProviderStore;
}): Promise<boolean> {
  const record = await store.getProvider(tenant_id);
  return record !== undefined;
}

export async function resolveWebSearchProvider({
  tenant_id,
  store,
  metrics,
}: {
  tenant_id: string;
  store: IWebSearchProviderStore;
  metrics?: OperationMetrics | undefined;
}): Promise<IWebSearchProvider | undefined> {
  const record = await store.getProvider(tenant_id);
  if (!record) {
    return undefined;
  }
  const { manifest } = record;
  return new ParallelWebSearchProvider({
    apiKey: manifest.auth.api_key,
    mode: 'turbo',
    ...(metrics !== undefined ? { metrics } : {}),
  });
}
