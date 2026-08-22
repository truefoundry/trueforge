/**
 * Maps trueforge-ui sandbox-settings calls onto Harness
 * `/api/v1/settings/sandbox-providers` (singleton upsert, no delete).
 *
 * UI: multi-row providers with `id` / `catalogId` / `name` / flat `apiKey`.
 * Harness: one provider per tenant; catalog YAML has no name. The shared UI runtime
 * currently models Daytona lifecycle fields, so other provider variants stay hidden.
 */
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  SandboxCatalogServer,
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  SandboxProviderConfig,
  SandboxProviderListEntry,
} from '../../../server/types.js';

export type UiSandboxProvider = SandboxProviderBase;
export type UiSandboxProviderCatalogEntry = SandboxProviderCatalogEntry;
export type UiSandboxProviderListEntry = SandboxProviderListEntry;

type HarnessSandboxProvider = TrueForgeApi.CatalogSandboxProvider | TrueForgeApi.SandboxProviderManifest;
type HarnessDaytonaSandboxProvider = Extract<HarnessSandboxProvider, { type: 'daytona' }>;

const DAYTONA_TYPE = 'daytona';
const DAYTONA_DISPLAY_NAME = 'Daytona';

export function isUiSupportedSandboxProvider(provider: { type: string }): provider is { type: 'daytona' } {
  return provider.type === DAYTONA_TYPE;
}

function displayNameForType(type: string): string {
  if (type === DAYTONA_TYPE) {
    return DAYTONA_DISPLAY_NAME;
  }
  return type;
}

export function configFromHarness(provider: HarnessDaytonaSandboxProvider): SandboxProviderConfig {
  return {
    execTimeoutMs: provider.execTimeoutMs,
    autoStopIntervalInMinutes: provider.autoStopIntervalInMinutes,
    autoArchiveIntervalInMinutes: provider.autoArchiveIntervalInMinutes,
    autoDeleteIntervalInMinutes: provider.autoDeleteIntervalInMinutes,
  };
}

export function toUiCatalogEntry(
  provider: TrueForgeApi.CatalogSandboxProvider,
): UiSandboxProviderCatalogEntry | undefined {
  if (!isUiSupportedSandboxProvider(provider)) {
    return undefined;
  }
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
    ...configFromHarness(provider),
  };
}

export function toUiSandboxProvider(provider: TrueForgeApi.SandboxProviderManifest): UiSandboxProvider | undefined {
  if (!isUiSupportedSandboxProvider(provider)) {
    return undefined;
  }
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    catalogId: provider.type,
    isConnected: true,
    ...configFromHarness(provider),
  };
}

export function toUiSandboxProviderListEntry(
  response: TrueForgeApi.GetSandboxProviderResponse['data'],
): UiSandboxProviderListEntry | undefined {
  const provider = toUiSandboxProvider(response.manifest);
  if (provider === undefined) {
    return undefined;
  }
  return {
    data: provider,
    snapshotSyncStatus: {
      status: response.status,
      ...(response.statusReason ? { statusReason: response.statusReason } : {}),
    },
  };
}

export function filterUiSandboxProviders({
  providers,
  query,
}: {
  providers: UiSandboxProviderListEntry[];
  query?: string;
}): UiSandboxProviderListEntry[] {
  const normalizedQuery = query?.trim().toLowerCase();
  if (normalizedQuery === undefined || normalizedQuery === '') {
    return providers;
  }
  return providers.filter(
    provider =>
      provider.data.name.toLowerCase().includes(normalizedQuery) ||
      provider.data.id.toLowerCase().includes(normalizedQuery),
  );
}

export function toHarnessManifest(
  req: {
    type: string;
    apiKey: string;
  } & SandboxProviderConfig,
): TrueForgeApi.SandboxProviderManifest {
  if (req.type !== DAYTONA_TYPE) {
    throw new Error(`Unsupported sandbox provider type: ${req.type}`);
  }
  return {
    type: DAYTONA_TYPE,
    execTimeoutMs: req.execTimeoutMs,
    autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
    autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
    autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
    auth: { apiKey: req.apiKey },
  };
}

/** Settings sandbox-catalog port for `createTrueFoundryServer`. Delete omitted (no BE route). */
export function createSandboxProviderCatalog(client: TrueForge): SandboxCatalogServer {
  async function resolveApiKey(apiKey: string | undefined): Promise<string> {
    const trimmed = apiKey?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      return trimmed;
    }
    const existing = await client.settings.sandboxProviders.get();
    return existing.data.manifest.auth.apiKey;
  }

  return {
    getSandboxProviderCatalog: async () => {
      const body = await client.catalogs.sandboxProviders.list();
      return body.data.flatMap(provider => {
        const entry = toUiCatalogEntry(provider);
        return entry === undefined ? [] : [entry];
      });
    },
    listSandboxProviders: async req => {
      let providers: UiSandboxProviderListEntry[];
      try {
        const body = await client.settings.sandboxProviders.get();
        const provider = toUiSandboxProviderListEntry(body.data);
        providers = provider === undefined ? [] : [provider];
      } catch (err) {
        if (err instanceof TrueForgeApi.NotFoundError) {
          providers = [];
        } else {
          throw err;
        }
      }
      return filterUiSandboxProviders({ providers, query: req?.query });
    },
    createSandboxProvider: async req => {
      const body = await client.settings.sandboxProviders.createOrUpdate({
        manifest: toHarnessManifest({
          type: req.type,
          apiKey: req.apiKey,
          execTimeoutMs: req.execTimeoutMs,
          autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
          autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
          autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
        }),
      });
      const provider = toUiSandboxProvider(body.data.manifest);
      if (provider === undefined) {
        throw new Error(`Unsupported sandbox provider type: ${body.data.manifest.type}`);
      }
      return provider;
    },
    updateSandboxProvider: async req => {
      const apiKey = await resolveApiKey(req.apiKey);
      const body = await client.settings.sandboxProviders.createOrUpdate({
        manifest: toHarnessManifest({
          type: DAYTONA_TYPE,
          apiKey,
          execTimeoutMs: req.execTimeoutMs,
          autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
          autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
          autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
        }),
      });
      const provider = toUiSandboxProvider(body.data.manifest);
      if (provider === undefined) {
        throw new Error(`Unsupported sandbox provider type: ${body.data.manifest.type}`);
      }
      return provider;
    },
  };
}
