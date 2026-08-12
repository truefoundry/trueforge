/**
 * Maps trueforge-ui sandbox-settings calls onto Harness
 * `/api/v1/settings/sandbox-providers` (singleton upsert, no delete).
 *
 * UI: multi-row providers with `id` / `catalogId` / `name` / flat `apiKey`.
 * Harness: one Daytona provider per tenant; catalog YAML has no name — synthetic
 * identity uses `type` (`daytona`) as id/catalogId and display name `Daytona`.
 */
import type {
  SandboxCatalogServer,
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  SandboxProviderConfig,
} from '@truefoundry/trueforge-ui';
import { TrueForgeApi } from 'trueforge-sdk';
import { harnessClient as client } from './harnessClient';

export type UiSandboxProvider = SandboxProviderBase;
export type UiSandboxProviderCatalogEntry = SandboxProviderCatalogEntry;

const DAYTONA_TYPE = 'daytona';
const DAYTONA_DISPLAY_NAME = 'Daytona';

function displayNameForType(type: string): string {
  if (type === DAYTONA_TYPE) {
    return DAYTONA_DISPLAY_NAME;
  }
  return type;
}

export function configFromHarness(
  provider: TrueForgeApi.CatalogDaytonaSandboxProvider | TrueForgeApi.DaytonaSandboxProvider,
): SandboxProviderConfig {
  return {
    snapshotName: provider.snapshotName,
    execTimeoutMs: provider.execTimeoutMs,
    autoStopIntervalInMinutes: provider.autoStopIntervalInMinutes,
    autoArchiveIntervalInMinutes: provider.autoArchiveIntervalInMinutes,
    autoDeleteIntervalInMinutes: provider.autoDeleteIntervalInMinutes,
  };
}

export function toUiCatalogEntry(provider: TrueForgeApi.CatalogDaytonaSandboxProvider): UiSandboxProviderCatalogEntry {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    type: provider.type,
    ...configFromHarness(provider),
  };
}

export function toUiSandboxProvider(provider: TrueForgeApi.DaytonaSandboxProvider): UiSandboxProvider {
  return {
    id: provider.type,
    name: displayNameForType(provider.type),
    catalogId: provider.type,
    isConnected: true,
    ...configFromHarness(provider),
  };
}

export function toHarnessManifest(
  req: {
    type: string;
    apiKey: string;
  } & SandboxProviderConfig,
): TrueForgeApi.DaytonaSandboxProvider {
  if (req.type !== DAYTONA_TYPE) {
    throw new Error(`Unsupported sandbox provider type: ${req.type}`);
  }
  return {
    type: DAYTONA_TYPE,
    snapshotName: req.snapshotName,
    execTimeoutMs: req.execTimeoutMs,
    autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
    autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
    autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
    auth: { apiKey: req.apiKey },
  };
}

async function resolveApiKey(apiKey: string | undefined): Promise<string> {
  const trimmed = apiKey?.trim();
  if (trimmed !== undefined && trimmed !== '') {
    return trimmed;
  }
  const existing = await client.settings.sandboxProviders.get();
  return existing.data.auth.apiKey;
}

/** Settings sandbox-catalog port for `createTrueFoundryServer`. Delete omitted (no BE route). */
export function createSandboxProviderCatalog(): SandboxCatalogServer {
  return {
    getSandboxProviderCatalog: async () => {
      const body = await client.catalog.sandboxProviders.list();
      return body.data.map(toUiCatalogEntry);
    },
    listSandboxProviders: async req => {
      let providers: UiSandboxProvider[];
      try {
        const body = await client.settings.sandboxProviders.get();
        providers = [toUiSandboxProvider(body.data)];
      } catch (err) {
        if (err instanceof TrueForgeApi.NotFoundError) {
          providers = [];
        } else {
          throw err;
        }
      }
      const query = req?.query?.trim().toLowerCase();
      if (query === undefined || query === '') {
        return providers;
      }
      return providers.filter(
        provider =>
          provider.name.toLowerCase().includes(query) ||
          provider.id.toLowerCase().includes(query) ||
          provider.snapshotName.toLowerCase().includes(query),
      );
    },
    createSandboxProvider: async req => {
      const body = await client.settings.sandboxProviders.upsert(
        toHarnessManifest({
          type: req.type,
          apiKey: req.apiKey,
          snapshotName: req.snapshotName,
          execTimeoutMs: req.execTimeoutMs,
          autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
          autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
          autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
        }),
      );
      return toUiSandboxProvider(body.data);
    },
    updateSandboxProvider: async req => {
      const apiKey = await resolveApiKey(req.apiKey);
      const body = await client.settings.sandboxProviders.upsert(
        toHarnessManifest({
          type: DAYTONA_TYPE,
          apiKey,
          snapshotName: req.snapshotName,
          execTimeoutMs: req.execTimeoutMs,
          autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
          autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
          autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
        }),
      );
      return toUiSandboxProvider(body.data);
    },
  };
}
