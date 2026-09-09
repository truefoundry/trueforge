import { LRUCache } from 'lru-cache';
import { z } from 'zod';
import type { RequestContext } from '../auth/identity';
import type {
  ISandboxProviderStore,
  SandboxProviderRecord,
  UpdateSandboxStatusInput,
  UpsertSandboxProviderInput,
} from '../db/sandboxProviderStore';
import { callerAccessToken, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import {
  resolveTrueFoundrySandboxProviderConfig,
  type TrueFoundrySandboxProviderConfig,
} from './resolveTrueFoundrySandboxProviderConfig';

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const SETTINGS_FETCH_TIMEOUT_MS = 10_000;

const SANDBOX_DEFAULT_SETTINGS = {
  timeoutMs: 60_000,
  autoStopIntervalInMinutes: 5,
  autoArchiveIntervalInMinutes: 60,
  autoDeleteIntervalInMinutes: 43_200,
} as const;

const DaytonaSandboxSettingsSchema = z.object({
  snapshotName: z.string().min(1, 'snapshotName is required'),
  autoStopIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoStopIntervalInMinutes),
  autoArchiveIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoArchiveIntervalInMinutes),
  autoDeleteIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoDeleteIntervalInMinutes),
  timeoutMs: z.number().default(SANDBOX_DEFAULT_SETTINGS.timeoutMs),
});

type DaytonaSandboxSettings = z.infer<typeof DaytonaSandboxSettingsSchema>;

const DAYTONA_SETTINGS_CACHE_KEY = 'daytona-settings';

/** Process-wide shared settings, TTL refresh, single slot. */
const daytonaSettingsCache = new LRUCache<string, DaytonaSandboxSettings>({
  max: 1,
  ttl: SETTINGS_CACHE_TTL_MS,
});

async function resolveDaytonaSandboxSettings({
  accessToken,
  settingsServerUrl,
}: {
  accessToken: string;
  settingsServerUrl: string;
}): Promise<DaytonaSandboxSettings> {
  const cached = daytonaSettingsCache.get(DAYTONA_SETTINGS_CACHE_KEY);
  if (cached !== undefined) {
    return cached;
  }
  // Deployment settings server (config), not tenant-configurable — trusted like CONTROL_PLANE_URL.
  let response: Response;
  try {
    response = await fetch(settingsServerUrl, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SETTINGS_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new Error(
      timedOut
        ? `Sandbox settings endpoint timed out after ${String(SETTINGS_FETCH_TIMEOUT_MS / 1000)}s`
        : 'Sandbox settings endpoint request failed',
      { cause: error },
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sandbox settings endpoint returned ${String(response.status)}: ${body}`);
  }
  const settings = DaytonaSandboxSettingsSchema.parse(await response.json());
  daytonaSettingsCache.set(DAYTONA_SETTINGS_CACHE_KEY, settings);
  return settings;
}

async function synthesizeDaytonaRecord({
  tenantId,
  providerConfig,
  accessToken,
}: {
  tenantId: string;
  providerConfig: Extract<TrueFoundrySandboxProviderConfig, { type: 'daytona' }>;
  accessToken: string;
}): Promise<SandboxProviderRecord> {
  const settings = await resolveDaytonaSandboxSettings({
    accessToken,
    settingsServerUrl: providerConfig.settingsServerUrl,
  });
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    manifest: {
      type: 'daytona',
      auth: { api_key: providerConfig.apiKey },
      exec_timeout_ms: settings.timeoutMs,
      auto_stop_interval_in_minutes: settings.autoStopIntervalInMinutes,
      auto_archive_interval_in_minutes: settings.autoArchiveIntervalInMinutes,
      auto_delete_interval_in_minutes: settings.autoDeleteIntervalInMinutes,
    },
    status: 'ready',
    status_reason: null,
    // Snapshot name only — no image_uri; TrueFoundry mode never registers a snapshot.
    build_metadata: { build_ref: settings.snapshotName },
    created_at: now,
    // Fresh on every get so checkSnapshotStatus short-circuits without Daytona.
    updated_at: now,
  };
}

function synthesizeTfyRecord({
  tenantId,
  providerConfig,
}: {
  tenantId: string;
  providerConfig: Extract<TrueFoundrySandboxProviderConfig, { type: 'truefoundry' }>;
}): SandboxProviderRecord {
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    manifest: {
      type: 'truefoundry',
      server_url: providerConfig.serverUrl,
      nats_bridge_url: providerConfig.natsBridgeUrl,
      exec_timeout_ms: SANDBOX_DEFAULT_SETTINGS.timeoutMs,
    },
    status: 'ready',
    status_reason: null,
    build_metadata: null,
    created_at: now,
    updated_at: now,
  };
}

export class TrueFoundrySandboxProviderStore<TTransaction = never> implements ISandboxProviderStore<TTransaction> {
  readonly #resolveAccessToken: ResolveAccessToken;

  constructor(input: { context: RequestContext }) {
    this.#resolveAccessToken = callerAccessToken(input.context);
  }

  async getSandboxProvider(tenantId: string, transaction?: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void transaction;
    const providerConfig = resolveTrueFoundrySandboxProviderConfig();
    if (!providerConfig) {
      return undefined;
    }
    switch (providerConfig.type) {
      case 'daytona':
        return synthesizeDaytonaRecord({
          tenantId,
          providerConfig,
          accessToken: await this.#resolveAccessToken(),
        });
      case 'truefoundry':
        return synthesizeTfyRecord({ tenantId, providerConfig });
    }
  }

  getSandboxProviderForUpdate(tenantId: string, transaction: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void tenantId;
    void transaction;
    return trueFoundryManaged();
  }

  upsertSandboxProvider(input: UpsertSandboxProviderInput, transaction?: TTransaction): Promise<SandboxProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: TTransaction,
  ): Promise<SandboxProviderRecord | undefined> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }
}
