/**
 * TrueForge HTTP client for the Harness adapter.
 * Auth is host-owned: pass `token` (Bearer) and/or a custom `fetch` (e.g. cookie + OIDC).
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';

import { withSdkHttpTimeoutTracking } from '../../analytics/trackSdkHttpTimeout.js';

export interface CreateTrueForgeClientOptions {
  baseUrl?: string;
  /** SDK Bearer token (`Authorization: Bearer …`). */
  token?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = '/';

/**
 * SDK passthrough `fetch` only attaches Bearer when `baseUrl` and the request URL
 * are absolute same-origin URLs. Relative defaults like `/` fail that check, so
 * absolutize against the page origin in the browser.
 */
export function resolveTrueForgeBaseUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) return baseUrl;
  const origin = globalThis.location?.origin;
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    return new URL(baseUrl, origin).href;
  }
  return baseUrl;
}

export function createTrueForgeClient(options: CreateTrueForgeClientOptions = {}): TrueForge {
  const fetchFn = withSdkHttpTimeoutTracking(options.fetch ?? globalThis.fetch.bind(globalThis));
  return new TrueForge({
    baseUrl: resolveTrueForgeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: fetchFn,
    ...(options.token === undefined ? {} : { token: options.token }),
  });
}

export function parseIsoDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return date;
}
