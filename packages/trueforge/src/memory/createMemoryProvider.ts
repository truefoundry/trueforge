import type { Logger } from 'winston';
import type { MemoryProvider } from './MemoryProvider';
import { ZepMemoryProvider } from './zep/ZepMemoryProvider';

export interface MemoryProviderOptions {
  zep: { apiKey: string; baseUrl: string };
  logger: Logger;
}

/** Zep is the only provider today; choose by configuration here once a second one lands. */
export function createMemoryProvider(options: MemoryProviderOptions): MemoryProvider {
  return new ZepMemoryProvider({ ...options.zep, logger: options.logger });
}
