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

function resolveUrl(url: string): URL | null {
  try {
    // Base required so protocol-relative (`//host/path`) and relative URLs parse.
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    return new URL(url, base);
  } catch {
    return null;
  }
}

/** Hostname for http(s) URLs resolved against the page; null for non-http(s) or unparseable. */
export function getHostname(url: string): string | null {
  const parsed = resolveUrl(url);
  if (parsed == null) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.toLowerCase();
}

/**
 * True when `url` resolves to http(s) on a host that differs from the page host.
 * Same-origin, data:, blob:, and other non-http(s) schemes return false.
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
  const parsed = resolveUrl(url);
  if (parsed == null) return;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
}
