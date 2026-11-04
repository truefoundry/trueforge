import type { Logger } from 'winston';
import type { TrueFoundryMemoryProviderConfig } from '../truefoundry/resolveTrueFoundryMemoryProviderConfig';
import type { MemoryProvider } from './MemoryProvider';
import { ZepMemoryProvider } from './zep/ZepMemoryProvider';

export interface MemoryProviderOptions {
  config: TrueFoundryMemoryProviderConfig;
  logger: Logger;
}

export function createMemoryProvider({ config, logger }: MemoryProviderOptions): MemoryProvider {
  switch (config.type) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- one provider today; more get a case here
    case 'zep':
      return new ZepMemoryProvider({ apiKey: config.apiKey, baseUrl: config.serverUrl, logger });
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unsupported memory provider: ${String(_exhaustive)}`);
    }
  }
}
