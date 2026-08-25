/**
 * Process-scoped local-sandbox probe cache. `isSupported()` inits SRT and
 * creates a temp sandbox — run once at standalone boot, never per request.
 */
import configuration from '../config';
import type { LocalSandboxSupportResult } from './local/provider/LocalSandboxProvider';

let cachedSupport: LocalSandboxSupportResult | undefined;

export function setCachedLocalSandboxSupport(support: LocalSandboxSupportResult | undefined): void {
  cachedSupport = support;
}

export function getCachedLocalSandboxSupport(): LocalSandboxSupportResult | undefined {
  return cachedSupport;
}

/** Standalone + cached probe succeeded. No DB row required. */
export function isLocalSandboxFallbackEnabled(): boolean {
  return configuration.STANDALONE && cachedSupport?.supported === true;
}
