import type { Logger } from 'winston';
import type { MemoryProviderManifest } from '../schemas/memoryProvider';
import type { MemoryProvider } from './MemoryProvider';
import { ZEP_DEFAULT_BASE_URL, ZepMemoryProvider } from './zep/ZepMemoryProvider';

export interface MemoryProviderOptions {
  manifest: MemoryProviderManifest;
  logger: Logger;
}

export function createMemoryProvider({ manifest, logger }: MemoryProviderOptions): MemoryProvider {
  switch (manifest.type) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- one provider today; more get a case here
    case 'zep':
      return new ZepMemoryProvider({
        apiKey: manifest.auth.api_key,
        baseUrl: manifest.server_url ?? ZEP_DEFAULT_BASE_URL,
        logger,
      });
    default: {
      const _exhaustive: never = manifest.type;
      throw new Error(`Unsupported memory provider: ${String(_exhaustive)}`);
    }
  }
}
