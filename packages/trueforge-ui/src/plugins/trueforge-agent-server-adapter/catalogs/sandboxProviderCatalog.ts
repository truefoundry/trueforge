/**
 * Maps trueforge-ui sandbox-settings calls onto Harness
 * `/api/v1/settings/sandbox-providers` (singleton upsert, no delete).
 *
 * UI: multi-row providers with `id` / `catalogId` / `name` / flat `apiKey`.
 * Harness: one Daytona provider per tenant; catalog YAML has no name — synthetic
 * identity uses `type` (`daytona`) as id/catalogId and display name `Daytona`.
 *
 * Daytona lifecycle fields live here as a host extension of the generic sandbox
 * port types (identity + credentials only).
 */
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  CreateSandboxProviderRequest,
  SandboxCatalogServer,
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  SandboxProviderListEntry,
  UpdateSandboxProviderRequest,
} from '../../../server/types.js';

/** Daytona-only sandbox lifecycle settings. Not on the generic sandbox port. */
export interface DaytonaSandboxConfig {
  execTimeoutMs: number;
  autoStopIntervalInMinutes: number;
  autoArchiveIntervalInMinutes: number;
  autoDeleteIntervalInMinutes: number;
}

export type UiSandboxProvider = SandboxProviderBase & DaytonaSandboxConfig;
export type UiSandboxProviderCatalogEntry = SandboxProviderCatalogEntry & DaytonaSandboxConfig;
export type UiSandboxProviderListEntry = SandboxProviderListEntry<UiSandboxProvider>;
export type UiCreateSandboxProviderRequest = CreateSandboxProviderRequest & DaytonaSandboxConfig;
export type UiUpdateSandboxProviderRequest = UpdateSandboxProviderRequest & DaytonaSandboxConfig;

export type DaytonaSandboxCatalogServer = SandboxCatalogServer<
  UiSandboxProvider,
  UiSandboxProviderCatalogEntry,
  UiCreateSandboxProviderRequest,
  UiUpdateSandboxProviderRequest,
  UiSandboxProviderListEntry
>;

const DAYTONA_TYPE = 'daytona';
const DAYTONA_DISPLAY_NAME = 'Daytona';

function displayNameForType(type: string): string {
  if (type === DAYTONA_TYPE) {
    return DAYTONA_DISPLAY_NAME;
  }
  return type;
}

export function isDaytonaSandboxConfig(value: object): value is DaytonaSandboxConfig {
  return (
    'execTimeoutMs' in value &&
    typeof value.execTimeoutMs === 'number' &&
    'autoStopIntervalInMinutes' in value &&
    typeof value.autoStopIntervalInMinutes === 'number' &&
    'autoArchiveIntervalInMinutes' in value &&
    typeof value.autoArchiveIntervalInMinutes === 'number' &&
    'autoDeleteIntervalInMinutes' in value &&
    typeof value.autoDeleteIntervalInMinutes === 'number'
  );
}

export function configFromHarness(
  provider: TrueForgeApi.CatalogSandboxProvider | TrueForgeApi.SandboxProviderManifest,
): DaytonaSandboxConfig {
  return {
    execTimeoutMs: provider.execTimeoutMs,
    autoStopIntervalInMinutes: provider.autoStopIntervalInMinutes,
    autoArchiveIntervalInMinutes: provider.autoArchiveIntervalInMinutes,
    autoDeleteIntervalInMinutes: provider.autoDeleteIntervalInMinutes,
  };
}

export function toUiCatalogEntry(provider: TrueForgeApi.CatalogSandboxProvider): UiSandboxProviderCatalogEntry {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
    ...configFromHarness(provider),
  };
}

export function toUiSandboxProvider(provider: TrueForgeApi.SandboxProviderManifest): UiSandboxProvider {
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
): UiSandboxProviderListEntry {
  return {
    data: toUiSandboxProvider(response.manifest),
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
  } & DaytonaSandboxConfig,
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

/** Settings sandbox-catalog port for `createTrueForgeServer`. Delete omitted (no BE route). */
export function createSandboxProviderCatalog(client: TrueForge): DaytonaSandboxCatalogServer {
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
      return body.data.map(toUiCatalogEntry);
    },
    listSandboxProviders: async req => {
      let providers: UiSandboxProviderListEntry[];
      try {
        const body = await client.settings.sandboxProviders.get();
        providers = [toUiSandboxProviderListEntry(body.data)];
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
      return toUiSandboxProvider(body.data.manifest);
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
      return toUiSandboxProvider(body.data.manifest);
    },
  };
}
