import type { Logger } from 'winston';
import type { DistributedServerConfiguration } from '../config';
import { createMemoryProvider } from './createMemoryProvider';
import type { MemoryProvider } from './MemoryProvider';
import { FlagMemorySettings, type MemorySettings } from './MemorySettings';

/** Memory as configured for this deployment: one provider, plus the tenant-level switch. */
export interface ConfiguredMemory {
  provider: MemoryProvider;
  settings: MemorySettings;
}

export type MemoryProviderConfiguration = Pick<
  DistributedServerConfiguration,
  'TRUEFOUNDRY_MEMORY_ENABLED' | 'TRUEFOUNDRY_ZEP_API_KEY' | 'TRUEFOUNDRY_ZEP_BASE_URL'
>;

/**
 * Memory from TrueFoundry-mode configuration (like the shared sandbox and web search), shared by the
 * server (retrieval and writes) and the controller (ingestion). Undefined while memory is off.
 */
export function memoryFromConfig({
  config,
  logger,
}: {
  config: MemoryProviderConfiguration;
  logger: Logger;
}): ConfiguredMemory | undefined {
  if (!config.TRUEFOUNDRY_MEMORY_ENABLED) {
    return undefined;
  }
  if (config.TRUEFOUNDRY_ZEP_API_KEY === undefined) {
    throw new Error('TRUEFOUNDRY_MEMORY_ENABLED=true requires TRUEFOUNDRY_ZEP_API_KEY');
  }
  return {
    provider: createMemoryProvider({
      zep: { apiKey: config.TRUEFOUNDRY_ZEP_API_KEY, baseUrl: config.TRUEFOUNDRY_ZEP_BASE_URL },
      logger,
    }),
    settings: new FlagMemorySettings({ enabled: true }),
  };
}
