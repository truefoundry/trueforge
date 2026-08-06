/**
 * Shared TrueForge HTTP client for the Harness host app.
 * One place for baseUrl / future auth (headers, API key) so catalog adapters
 * and the chat server do not each construct their own client.
 */
import { TrueForge } from 'trueforge';

export interface CreateHarnessClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = '/';

export function createHarnessClient(options: CreateHarnessClientOptions = {}): TrueForge {
  return new TrueForge({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/** Default browser client — Vite proxies `/api/*` to the Harness server. */
export const harnessClient = createHarnessClient();
