import { z } from 'zod';
import type { DistributedServerConfiguration } from '../config';
import { ZEP_DEFAULT_BASE_URL } from '../memory/zep/ZepMemoryProvider';

/** Memory-ingest loop settings JSON in `TRUEFOUNDRY_MEMORY_SETTINGS`; every field is optional. */
export const TrueFoundryMemorySettingsSchema = z
  .object({
    /** Gap between ingest runs. */
    interval_ms: z
      .number()
      .int()
      .positive()
      .default(5 * 60 * 1000),
    /** Sessions processed per run. */
    max_sessions_per_run: z.number().int().positive().default(50),
    /** Exchanges sent per session per run. */
    max_exchanges_per_session: z.number().int().positive().default(20),
    /** How far back a session's latest turn is picked up; sessions not ingested by then are dropped. */
    lookback_ms: z
      .number()
      .int()
      .positive()
      .default(2 * 60 * 60 * 1000),
  })
  .strict();

export type TrueFoundryMemorySettings = z.infer<typeof TrueFoundryMemorySettingsSchema>;

/** Shared memory provider selected by env in TrueFoundry mode. */
export interface TrueFoundryMemoryProviderConfig {
  type: 'zep';
  apiKey: string;
  serverUrl: string;
  settings: TrueFoundryMemorySettings;
}

function parseSettingsJson(raw: string | undefined): unknown {
  if (raw === undefined) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('TRUEFOUNDRY_MEMORY_SETTINGS must be valid JSON', { cause: error });
  }
}

/** Removed key. Accepted and ignored so an upgrade does not fail startup. */
const RETIRED_MEMORY_SETTING_KEYS = new Set<string>(['pause_timeout_ms']);

function withoutRetiredSettings(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const settings: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (RETIRED_MEMORY_SETTING_KEYS.has(key)) {
      continue;
    }
    settings[key] = entry;
  }
  return settings;
}

/** Returns the configured shared memory provider when enabled, or undefined when disabled. */
export function resolveTrueFoundryMemoryProviderConfig(
  config: Pick<
    DistributedServerConfiguration,
    | 'TRUEFOUNDRY_MEMORY_ENABLED'
    | 'TRUEFOUNDRY_MEMORY_PROVIDER'
    | 'TRUEFOUNDRY_MEMORY_API_KEY'
    | 'TRUEFOUNDRY_MEMORY_SERVER_URL'
    | 'TRUEFOUNDRY_MEMORY_SETTINGS'
  >,
): TrueFoundryMemoryProviderConfig | undefined {
  if (!config.TRUEFOUNDRY_MEMORY_ENABLED) {
    return undefined;
  }
  const settings = TrueFoundryMemorySettingsSchema.parse(
    withoutRetiredSettings(parseSettingsJson(config.TRUEFOUNDRY_MEMORY_SETTINGS)),
  );
  switch (config.TRUEFOUNDRY_MEMORY_PROVIDER) {
    case 'zep': {
      if (config.TRUEFOUNDRY_MEMORY_API_KEY === undefined) {
        throw new Error('TRUEFOUNDRY_MEMORY_API_KEY is required when TRUEFOUNDRY_MEMORY_PROVIDER is zep');
      }
      return {
        type: 'zep',
        apiKey: config.TRUEFOUNDRY_MEMORY_API_KEY,
        serverUrl: config.TRUEFOUNDRY_MEMORY_SERVER_URL ?? ZEP_DEFAULT_BASE_URL,
        settings,
      };
    }
    case undefined:
      return undefined;
  }
}
