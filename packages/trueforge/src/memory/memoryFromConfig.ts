import type { Logger } from 'winston';
import type { DistributedServerConfiguration } from '../config';
import { resolveTrueFoundryMemoryProviderConfig } from '../truefoundry/resolveTrueFoundryMemoryProviderConfig';
import { createMemoryProvider } from './createMemoryProvider';
import type { MemoryProvider } from './MemoryProvider';
import { TenantAllowlistMemorySettings, type MemorySettings } from './MemorySettings';

/** Memory as configured for this deployment: one provider, plus the tenant-level switch. */
export interface ConfiguredMemory {
  provider: MemoryProvider;
  settings: MemorySettings;
}

export type MemoryProviderConfiguration = Pick<
  DistributedServerConfiguration,
  | 'TRUEFOUNDRY_MEMORY_ENABLED'
  | 'TRUEFOUNDRY_MEMORY_PROVIDER'
  | 'TRUEFOUNDRY_MEMORY_API_KEY'
  | 'TRUEFOUNDRY_MEMORY_SERVER_URL'
  | 'TRUEFOUNDRY_MEMORY_SETTINGS'
  | 'TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST'
>;

/**
 * The server's memory (summaries, `memory_search`, `memory_add`), built from TrueFoundry-mode
 * configuration. Undefined while `TRUEFOUNDRY_MEMORY_ENABLED` is off.
 */
export function memoryFromConfig({
  config,
  logger,
}: {
  config: MemoryProviderConfiguration;
  logger: Logger;
}): ConfiguredMemory | undefined {
  const providerConfig = resolveTrueFoundryMemoryProviderConfig(config);
  if (providerConfig === undefined) {
    return undefined;
  }
  return {
    provider: createMemoryProvider({ config: providerConfig, logger }),
    settings: new TenantAllowlistMemorySettings({ tenantIds: config.TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST }),
  };
}
