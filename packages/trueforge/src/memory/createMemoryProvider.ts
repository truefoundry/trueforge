import type { Logger } from 'winston';
import type { TrueFoundryMemoryProviderConfig } from '../truefoundry/resolveTrueFoundryMemoryProviderConfig';
import type { MemoryProvider } from './MemoryProvider';
import { ZepMemoryProvider } from './zep/ZepMemoryProvider';

export interface MemoryProviderOptions {
  config: TrueFoundryMemoryProviderConfig;
  logger: Logger;
}

/** Zep is the only provider today; choose by `config.type` here once a second one lands. */
export function createMemoryProvider({ config, logger }: MemoryProviderOptions): MemoryProvider {
  return new ZepMemoryProvider({ apiKey: config.apiKey, baseUrl: config.serverUrl, logger });
}
