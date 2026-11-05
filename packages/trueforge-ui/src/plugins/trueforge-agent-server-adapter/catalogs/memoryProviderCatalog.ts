/**
 * Maps trueforge-ui memory-settings calls onto Harness
 * `/api/v1/settings/memory-providers` (singleton upsert, no delete).
 *
 * Harness: one Zep provider per tenant; catalog YAML has no name, so the synthetic
 * identity uses `type` (`zep`) as id/catalogId and display name `Zep`.
 */
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { MemoryCatalogServer, MemoryProviderBase, MemoryProviderCatalogEntry } from '../../../server/types.js';

const ZEP_TYPE = 'zep';
const ZEP_DISPLAY_NAME = 'Zep';

function displayNameForType(type: string): string {
  return type === ZEP_TYPE ? ZEP_DISPLAY_NAME : type;
}

export function toUiMemoryCatalogEntry(provider: TrueForgeApi.CatalogMemoryProvider): MemoryProviderCatalogEntry {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
  };
}

export function toUiMemoryProvider(provider: TrueForgeApi.MemoryProviderManifest): MemoryProviderBase {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    catalogId: provider.type,
    isConnected: true,
    ...(provider.serverUrl === undefined ? {} : { serverUrl: provider.serverUrl }),
  };
}

export function toHarnessMemoryManifest({
  type,
  apiKey,
  serverUrl,
}: {
  type: string;
  apiKey: string;
  serverUrl: string | undefined;
}): TrueForgeApi.MemoryProviderManifest {
  if (type !== ZEP_TYPE) {
    throw new Error(`Unsupported memory provider type: ${type}`);
  }
  const trimmedUrl = serverUrl?.trim();
  return {
    type: ZEP_TYPE,
    ...(trimmedUrl === undefined || trimmedUrl === '' ? {} : { serverUrl: trimmedUrl }),
    auth: { apiKey },
  };
}

/** Settings memory-catalog port for `createTrueForgeServer`. Delete omitted (no BE route). */
export function createMemoryProviderCatalog(client: TrueForge): MemoryCatalogServer {
  async function resolveApiKey(apiKey: string | undefined): Promise<string> {
    const trimmed = apiKey?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      return trimmed;
    }
    const existing = await client.settings.memoryProviders.get();
    return existing.data.manifest.auth.apiKey;
  }

  return {
    getMemoryProviderCatalog: async () => {
      const body = await client.catalogs.memoryProviders.list();
      return body.data.map(toUiMemoryCatalogEntry);
    },
    listMemoryProviders: async () => {
      try {
        const body = await client.settings.memoryProviders.get();
        return [toUiMemoryProvider(body.data.manifest)];
      } catch (err) {
        if (err instanceof TrueForgeApi.NotFoundError) {
          return [];
        }
        throw err;
      }
    },
    createMemoryProvider: async req => {
      const body = await client.settings.memoryProviders.createOrUpdate({
        manifest: toHarnessMemoryManifest({ type: req.type, apiKey: req.apiKey, serverUrl: req.serverUrl }),
      });
      return toUiMemoryProvider(body.data.manifest);
    },
    updateMemoryProvider: async req => {
      const apiKey = await resolveApiKey(req.apiKey);
      const body = await client.settings.memoryProviders.createOrUpdate({
        manifest: toHarnessMemoryManifest({ type: ZEP_TYPE, apiKey, serverUrl: req.serverUrl }),
      });
      return toUiMemoryProvider(body.data.manifest);
    },
  };
}
