import type { Logger } from 'winston';
import type { MemoryProvider, MemoryProviderName } from './MemoryProvider';
import { ZepMemoryProvider } from './zep/ZepMemoryProvider';

export interface MemoryProviderOptions {
  provider: MemoryProviderName;
  zep: { apiKey: string; baseUrl: string };
  logger: Logger;
}

const PROVIDER_FACTORIES: Record<MemoryProviderName, (options: MemoryProviderOptions) => MemoryProvider> = {
  zep: options => new ZepMemoryProvider({ ...options.zep, logger: options.logger }),
};

export function createMemoryProvider(options: MemoryProviderOptions): MemoryProvider {
  return PROVIDER_FACTORIES[options.provider](options);
}
