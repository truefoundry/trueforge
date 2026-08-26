/**
 * Maps trueforge-ui sandbox-settings calls onto Harness
 * `/api/v1/settings/sandbox-providers` (singleton upsert, no delete).
 *
 * UI: multi-row providers with `id` / `catalogId` / `name` / flat `apiKey`.
 * Harness: one provider per tenant; catalog YAML has no name — synthetic identity
 * uses `type` as id/catalogId and a provider-specific display name.
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

const DAYTONA_TYPE = 'daytona';
const OPENSANDBOX_TYPE = 'opensandbox';

function displayNameForType(type: string): string {
  return type === DAYTONA_TYPE ? 'Daytona' : type === OPENSANDBOX_TYPE ? 'OpenSandbox' : type;
}

type UiSandboxConfig = SandboxProviderConfig & {
  domain?: string;
  protocol?: 'http' | 'https';
};

export function configFromHarness(
  provider: TrueForgeApi.CatalogSandboxProvider | TrueForgeApi.SandboxProviderManifest,
): UiSandboxConfig {
  if (provider.type === OPENSANDBOX_TYPE) {
    return {
      execTimeoutMs: provider.execTimeoutMs,
      autoStopIntervalInMinutes: 0,
      autoArchiveIntervalInMinutes: 0,
      autoDeleteIntervalInMinutes: 0,
      domain: provider.domain,
      protocol: provider.protocol ?? 'https',
    };
  }
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
    domain?: string;
    protocol?: 'http' | 'https';
  } & SandboxProviderConfig,
): TrueForgeApi.SandboxProviderManifest {
  if (req.type === OPENSANDBOX_TYPE) {
    if (req.domain === undefined || req.domain.trim() === '') {
      throw new Error('OpenSandbox domain is required');
    }
    return {
      type: OPENSANDBOX_TYPE,
      execTimeoutMs: req.execTimeoutMs,
      domain: req.domain,
      protocol: req.protocol ?? 'https',
      auth: { apiKey: req.apiKey },
    };
  }
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

  async function resolveExistingManifest(): Promise<TrueForgeApi.SandboxProviderManifest> {
    const existing = await client.settings.sandboxProviders.get();
    return existing.data.manifest;
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
          ...('domain' in req && typeof req.domain === 'string' ? { domain: req.domain } : {}),
          ...('protocol' in req && (req.protocol === 'http' || req.protocol === 'https')
            ? { protocol: req.protocol }
            : {}),
        }),
      });
      return toUiSandboxProvider(body.data.manifest);
    },
    updateSandboxProvider: async req => {
      const existingManifest = await resolveExistingManifest();
      const apiKey = await resolveApiKey(req.apiKey);
      const body = await client.settings.sandboxProviders.createOrUpdate({
        manifest: toHarnessManifest({
          type: existingManifest.type,
          apiKey,
          execTimeoutMs: req.execTimeoutMs,
          autoStopIntervalInMinutes:
            'autoStopIntervalInMinutes' in req
              ? req.autoStopIntervalInMinutes
              : 'autoStopIntervalInMinutes' in existingManifest
                ? existingManifest.autoStopIntervalInMinutes
                : 0,
          autoArchiveIntervalInMinutes:
            'autoArchiveIntervalInMinutes' in req
              ? req.autoArchiveIntervalInMinutes
              : 'autoArchiveIntervalInMinutes' in existingManifest
                ? existingManifest.autoArchiveIntervalInMinutes
                : 0,
          autoDeleteIntervalInMinutes:
            'autoDeleteIntervalInMinutes' in req
              ? req.autoDeleteIntervalInMinutes
              : 'autoDeleteIntervalInMinutes' in existingManifest
                ? existingManifest.autoDeleteIntervalInMinutes
                : 0,
          ...('domain' in req && typeof req.domain === 'string'
            ? { domain: req.domain }
            : 'domain' in existingManifest
              ? { domain: existingManifest.domain }
              : {}),
          ...('protocol' in req && (req.protocol === 'http' || req.protocol === 'https')
            ? { protocol: req.protocol }
            : 'protocol' in existingManifest
              ? { protocol: existingManifest.protocol }
              : {}),
        }),
      });
      return toUiSandboxProvider(body.data.manifest);
    },
  };
}
