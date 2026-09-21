import { ParallelWebSearchProvider, type IWebSearchProvider } from '@truefoundry/trueforge-core/core';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';

export async function hasConfiguredWebSearchProvider({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IWebSearchProviderStore;
}): Promise<boolean> {
  const providers = await store.listProviders({ tenant_id });
  return providers.length > 0;
}

export async function resolveWebSearchProvider({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IWebSearchProviderStore;
}): Promise<IWebSearchProvider | undefined> {
  const providers = await store.listProviders({ tenant_id });
  const record = providers[0];
  if (!record) {
    return undefined;
  }
  const { manifest } = record;
  return new ParallelWebSearchProvider({ apiKey: manifest.auth.api_key, mode: manifest.mode });
}
