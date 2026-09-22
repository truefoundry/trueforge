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
  WebSearchProviderConfig,
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

export function configFromHarness(
  provider: TrueForgeApi.CatalogWebSearchProvider | TrueForgeApi.WebSearchProviderManifest,
): WebSearchProviderConfig {
  return {
    mode: provider.mode,
  };
}

export function toUiCatalogEntry(provider: TrueForgeApi.CatalogWebSearchProvider): UiWebSearchProviderCatalogEntry {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
    ...configFromHarness(provider),
  };
}

export function toUiWebSearchProvider(provider: TrueForgeApi.WebSearchProviderManifest): UiWebSearchProvider {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    catalogId: provider.type,
    isConnected: true,
    ...configFromHarness(provider),
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

export function toHarnessManifest(
  req: {
    type: string;
    apiKey: string;
  } & WebSearchProviderConfig,
): TrueForgeApi.WebSearchProviderManifest {
  if (req.type !== PARALLEL_TYPE) {
    throw new Error(`Unsupported web-search provider type: ${req.type}`);
  }
  return {
    type: PARALLEL_TYPE,
    mode: req.mode,
    auth: { apiKey: req.apiKey },
  };
}

function findExistingProvider(
  providers: TrueForgeApi.ConfiguredWebSearchProvider[],
  id: string,
): TrueForgeApi.ConfiguredWebSearchProvider | undefined {
  return providers.find(provider => provider.name === id || provider.manifest.type === id);
}

/** Settings web-search-catalog port for `createTrueForgeServer`. Delete omitted (no BE route). */
export function createWebSearchProviderCatalog(client: TrueForge): WebSearchCatalogServer {
  async function resolveApiKey({ apiKey, id }: { apiKey: string | undefined; id: string }): Promise<string> {
    const trimmed = apiKey?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      return trimmed;
    }
    const existing = await client.settings.webSearchProviders.list();
    const match = findExistingProvider(existing.data, id);
    if (match === undefined) {
      throw new Error('API key is required');
    }
    return match.manifest.auth.apiKey;
  }

  return {
    getWebSearchProviderCatalog: async () => {
      const body = await client.catalogs.webSearchProviders.list();
      return body.data.map(toUiCatalogEntry);
    },
    listWebSearchProviders: async req => {
      const body = await client.settings.webSearchProviders.list();
      const providers = body.data.map(entry => toUiWebSearchProvider(entry.manifest));
      return filterUiWebSearchProviders({ providers, query: req?.query });
    },
    createWebSearchProvider: async req => {
      const body = await client.settings.webSearchProviders.create({
        manifest: toHarnessManifest({
          type: req.type,
          apiKey: req.apiKey,
          mode: req.mode,
        }),
      });
      return toUiWebSearchProvider(body.data.manifest);
    },
    updateWebSearchProvider: async req => {
      const apiKey = await resolveApiKey({ apiKey: req.apiKey, id: req.id });
      const body = await client.settings.webSearchProviders.createOrUpdate({
        manifest: toHarnessManifest({
          type: req.id,
          apiKey,
          mode: req.mode,
        }),
      });
      return toUiWebSearchProvider(body.data.manifest);
    },
  };
}
