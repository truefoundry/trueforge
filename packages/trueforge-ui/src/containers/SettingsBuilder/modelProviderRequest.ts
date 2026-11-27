import type { CreateModelProviderRequest, ModelProviderCatalogEntry } from '../../server/types.js';
import type { ModelProviderKeyDraft } from './ConfigureModelProviderForm.js';

/** Create request for a discovery-catalog provider; a blank base URL keeps the provider's default endpoint. */
export function buildCreateModelProviderRequest({
  entry,
  draft,
}: {
  entry: ModelProviderCatalogEntry;
  draft: ModelProviderKeyDraft;
}): CreateModelProviderRequest {
  return {
    type: entry.type,
    name: entry.name,
    ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
    apiKey: draft.apiKey,
    models: entry.models,
  };
}
