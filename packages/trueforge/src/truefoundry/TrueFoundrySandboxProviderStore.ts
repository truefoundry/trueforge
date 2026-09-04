import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import configuration, { resolveTrueFoundrySandboxProviderConfig } from '../config';
import type {
  ISandboxProviderStore,
  SandboxProviderRecord,
  UpdateSandboxStatusInput,
  UpsertSandboxProviderInput,
} from '../db/sandboxProviderStore';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from './trueFoundryManaged';

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

let cachedRemoteDaytonaSettings:
  | {
      value: DaytonaSandboxSettings;
      expiresAt: number;
    }
  | undefined;

async function resolveDaytonaSandboxSettings({
  accessToken,
}: {
  accessToken: string;
}): Promise<DaytonaSandboxSettings> {
  const settingsServerUrl = configuration.SANDBOX_SETTINGS_SERVER_URL;
  if (settingsServerUrl === undefined) {
    throw new Error('SANDBOX_SETTINGS_SERVER_URL is required when resolving Daytona sandbox settings');
  }
  if (cachedRemoteDaytonaSettings !== undefined && Date.now() < cachedRemoteDaytonaSettings.expiresAt) {
    return cachedRemoteDaytonaSettings.value;
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
  cachedRemoteDaytonaSettings = { value: settings, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return settings;
}

/** @internal Exported for tests. */
export function __resetDaytonaSettingsCacheForTests(): void {
  cachedRemoteDaytonaSettings = undefined;
}

function managed(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

export class TrueFoundrySandboxProviderStore<TTransaction = never> implements ISandboxProviderStore<TTransaction> {
  readonly #accessToken: string;

  constructor(input: { accessToken: string }) {
    this.#accessToken = input.accessToken;
  }

  async getSandboxProvider(tenantId: string, transaction?: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void transaction;
    const providerConfig = resolveTrueFoundrySandboxProviderConfig();
    if (!providerConfig) {
      return undefined;
    }
    const settings = await resolveDaytonaSandboxSettings({ accessToken: this.#accessToken });
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
      // Snapshot name only — no image_uri; TFY mode never registers a snapshot.
      build_metadata: { build_ref: settings.snapshotName },
      created_at: now,
      // Fresh on every get so checkSnapshotStatus short-circuits without Daytona.
      updated_at: now,
    };
  }

  getSandboxProviderForUpdate(tenantId: string, transaction: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void tenantId;
    void transaction;
    return managed();
  }

  upsertSandboxProvider(input: UpsertSandboxProviderInput, transaction?: TTransaction): Promise<SandboxProviderRecord> {
    void input;
    void transaction;
    return managed();
  }

  updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: TTransaction,
  ): Promise<SandboxProviderRecord | undefined> {
    void input;
    void transaction;
    return managed();
  }
}
