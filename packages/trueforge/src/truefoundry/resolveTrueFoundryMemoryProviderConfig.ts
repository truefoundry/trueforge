import type { DistributedServerConfiguration } from '../config';
import { ZEP_DEFAULT_BASE_URL } from '../memory/zep/ZepMemoryProvider';

/** Shared memory provider selected by env in TrueFoundry mode. */
export interface TrueFoundryMemoryProviderConfig {
  type: 'zep';
  apiKey: string;
  serverUrl: string;
}

/** Returns the configured shared memory provider when enabled, or undefined when disabled. */
export function resolveTrueFoundryMemoryProviderConfig(
  config: Pick<
    DistributedServerConfiguration,
    | 'TRUEFOUNDRY_MEMORY_ENABLED'
    | 'TRUEFOUNDRY_MEMORY_PROVIDER'
    | 'TRUEFOUNDRY_MEMORY_API_KEY'
    | 'TRUEFOUNDRY_MEMORY_SERVER_URL'
  >,
): TrueFoundryMemoryProviderConfig | undefined {
  if (!config.TRUEFOUNDRY_MEMORY_ENABLED) {
    return undefined;
  }
  switch (config.TRUEFOUNDRY_MEMORY_PROVIDER) {
    case 'zep': {
      if (config.TRUEFOUNDRY_MEMORY_API_KEY === undefined) {
        throw new Error('TRUEFOUNDRY_MEMORY_API_KEY is required when TRUEFOUNDRY_MEMORY_PROVIDER is zep');
      }
      return {
        type: 'zep',
        apiKey: config.TRUEFOUNDRY_MEMORY_API_KEY,
        serverUrl: config.TRUEFOUNDRY_MEMORY_SERVER_URL ?? ZEP_DEFAULT_BASE_URL,
      };
    }
    case undefined:
      return undefined;
  }
}
