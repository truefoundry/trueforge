/**
 * TrueForge HTTP client for the Harness adapter.
 * Auth is host-owned: pass `token` (Bearer) and/or a custom `fetch` (e.g. cookie + OIDC).
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';

export interface CreateTrueForgeClientOptions {
  baseUrl?: string;
  /** SDK Bearer token (`Authorization: Bearer …`). */
  token?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = '/';

export function createTrueForgeClient(options: CreateTrueForgeClientOptions = {}): TrueForge {
  return new TrueForge({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
