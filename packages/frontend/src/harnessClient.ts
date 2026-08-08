/**
 * Shared TrueForge HTTP client for the Harness host app.
 * One place for baseUrl / future auth (headers, API key) so catalog adapters
 * and the chat server do not each construct their own client.
 *
 * Default `fetch` intercepts 401 and sends the browser through OIDC login.
 */
import { TrueForge } from 'trueforge-sdk';
import { createAuthAwareFetch } from './authFetch';

export interface CreateHarnessClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = '/';

export function createHarnessClient(options: CreateHarnessClientOptions = {}): TrueForge {
  return new TrueForge({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetch: createAuthAwareFetch(options.fetch ?? globalThis.fetch.bind(globalThis)),
  });
}

/** Default browser client — Vite proxies `/api/*` to the Harness server. */
export const harnessClient = createHarnessClient();
