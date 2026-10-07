export const EXTERNAL_URL_TRUST_STORAGE_KEY = 'aui-trusted-external-hosts';

export type ExternalUrlTrustKind = 'links' | 'images';

type StoredExternalUrlTrust = {
  version: 1;
  links: string[];
  images: string[];
};

function emptyStore(): StoredExternalUrlTrust {
  return { version: 1, links: [], images: [] };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function parseStore(raw: unknown): StoredExternalUrlTrust {
  if (raw == null || typeof raw !== 'object') return emptyStore();
  if (!('version' in raw) || raw.version !== 1) return emptyStore();
  const links = 'links' in raw && isStringArray(raw.links) ? raw.links : [];
  const images = 'images' in raw && isStringArray(raw.images) ? raw.images : [];
  return { version: 1, links, images };
}

function readStore(): StoredExternalUrlTrust {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(EXTERNAL_URL_TRUST_STORAGE_KEY) ?? 'null');
    return parseStore(raw);
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StoredExternalUrlTrust): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXTERNAL_URL_TRUST_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage can be unavailable or full; in-memory session approvals still work.
  }
}

/** Hostname for absolute http(s) URLs; null when the URL is not a parseable http(s) absolute URL. */
export function getHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when `url` is absolute http(s) and its host differs from the page host.
 * Relative, same-origin, data:, and blob: URLs return false (no third-party request).
 */
export function isExternalHttpUrl(url: string): boolean {
  const host = getHostname(url);
  if (host == null) return false;
  if (typeof window === 'undefined') return true;
  return host !== window.location.hostname.toLowerCase();
}

export function isTrustedHost({ kind, host }: { kind: ExternalUrlTrustKind; host: string }): boolean {
  const normalized = host.toLowerCase();
  const store = readStore();
  return store[kind].includes(normalized);
}

export function trustHost({ kind, host }: { kind: ExternalUrlTrustKind; host: string }): void {
  const normalized = host.toLowerCase();
  const store = readStore();
  if (store[kind].includes(normalized)) return;
  writeStore({
    ...store,
    [kind]: [...store[kind], normalized],
  });
}

/** Open http(s) URLs in a new tab; no-op for non-http(s) schemes (e.g. javascript:). */
export function openExternalHttpUrl(url: string): void {
  const host = getHostname(url);
  if (host == null) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
