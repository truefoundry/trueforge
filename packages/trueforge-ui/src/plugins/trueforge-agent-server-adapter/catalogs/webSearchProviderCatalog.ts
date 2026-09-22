/**
 * Maps trueforge-ui web-search-settings calls onto Harness
 * `/api/v1/settings/web-search-providers` (singleton upsert, no delete).
 *
 * UI: multi-row providers with `id` / `catalogId` / `name` / flat `apiKey`.
 * Harness: one Parallel provider per tenant; catalog YAML has no name — synthetic
 * identity uses `type` (`parallel`) as id/catalogId and display name `Parallel`.
 */
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  WebSearchCatalogServer,
  WebSearchProviderBase,
  WebSearchProviderCatalogEntry,
} from '../../../server/types.js';

export type UiWebSearchProvider = WebSearchProviderBase;
export type UiWebSearchProviderCatalogEntry = WebSearchProviderCatalogEntry;

const PARALLEL_TYPE = 'parallel';
const PARALLEL_DISPLAY_NAME = 'Parallel';

function displayNameForType(type: string): string {
  if (type === PARALLEL_TYPE) {
    return PARALLEL_DISPLAY_NAME;
  }
  return type;
}

export function toUiCatalogEntry(provider: TrueForgeApi.CatalogWebSearchProvider): UiWebSearchProviderCatalogEntry {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
  };
}

export function toUiWebSearchProvider(provider: TrueForgeApi.WebSearchProviderManifest): UiWebSearchProvider {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    catalogId: provider.type,
    isConnected: true,
  };
}

export function filterUiWebSearchProviders({
  providers,
  query,
}: {
  providers: UiWebSearchProvider[];
  query?: string;
}): UiWebSearchProvider[] {
  const normalizedQuery = query?.trim().toLowerCase();
  if (normalizedQuery === undefined || normalizedQuery === '') {
    return providers;
  }
  return providers.filter(
    provider =>
      provider.name.toLowerCase().includes(normalizedQuery) || provider.id.toLowerCase().includes(normalizedQuery),
  );
}

export function toHarnessManifest({
  type,
  apiKey,
}: {
  type: string;
  apiKey: string;
}): TrueForgeApi.WebSearchProviderManifest {
  if (type !== PARALLEL_TYPE) {
    throw new Error(`Unsupported web-search provider type: ${type}`);
  }
  return {
    type: PARALLEL_TYPE,
    auth: { apiKey },
  };
}

/** Settings web-search-catalog port for `createTrueForgeServer`. Delete omitted (no BE route). */
export function createWebSearchProviderCatalog(client: TrueForge): WebSearchCatalogServer {
  async function resolveApiKey(apiKey: string | undefined): Promise<string> {
    const trimmed = apiKey?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      return trimmed;
    }
    const existing = await client.settings.webSearchProviders.get();
    return existing.data.manifest.auth.apiKey;
  }

  return {
    getWebSearchProviderCatalog: async () => {
      const body = await client.catalogs.webSearchProviders.list();
      return body.data.map(toUiCatalogEntry);
    },
    listWebSearchProviders: async req => {
      let providers: UiWebSearchProvider[];
      try {
        const body = await client.settings.webSearchProviders.get();
        providers = [toUiWebSearchProvider(body.data.manifest)];
      } catch (err) {
        if (err instanceof TrueForgeApi.NotFoundError) {
          providers = [];
        } else {
          throw err;
        }
      }
      return filterUiWebSearchProviders({ providers, query: req?.query });
    },
    createWebSearchProvider: async req => {
      const body = await client.settings.webSearchProviders.createOrUpdate({
        manifest: toHarnessManifest({ type: req.type, apiKey: req.apiKey }),
      });
      return toUiWebSearchProvider(body.data.manifest);
    },
    updateWebSearchProvider: async req => {
      const apiKey = await resolveApiKey(req.apiKey);
      const body = await client.settings.webSearchProviders.createOrUpdate({
        manifest: toHarnessManifest({ type: PARALLEL_TYPE, apiKey }),
      });
      return toUiWebSearchProvider(body.data.manifest);
    },
  };
}
