import {
  readSessionShareSearch,
  writeSessionShareSearch,
  type SessionShareSearch,
  type SessionShareWrite,
} from '../utils/sessionShareUrl.js';
import { resolveRoutesConfig } from './paths.js';
import type { ShellRouteLocation } from './ShellRouteSyncCore.js';

export const SHELL_LOCATION_STORAGE_KEY = 'tfy-aui-shell-location';

type StoredShellLocation = {
  version: 1;
  pathname: string;
  search: string;
};

export type ShellLocationStore = {
  getLocation: () => ShellRouteLocation;
  navigate: (to: { pathname: string; search: string; hash?: string }, options?: { replace?: boolean }) => void;
  subscribe: (listener: () => void) => () => void;
  updateSearch: (next: SessionShareWrite) => string;
};

const DEFAULT_LOCATION: ShellRouteLocation = { pathname: '/', search: '', hash: '' };

function normalizeSearch(search: string): string {
  if (search.length === 0) return '';
  return search.startsWith('?') ? search : `?${search}`;
}

function hasShareParams(share: SessionShareSearch): boolean {
  return (
    share.view != null ||
    share.agentId != null ||
    share.sessionId != null ||
    share.tab != null ||
    share.timeRange != null
  );
}

function readStoredLocation(): ShellRouteLocation | null {
  try {
    const raw = sessionStorage.getItem(SHELL_LOCATION_STORAGE_KEY);
    if (raw == null || raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      (parsed as { version: unknown }).version !== 1 ||
      !('pathname' in parsed) ||
      typeof (parsed as { pathname: unknown }).pathname !== 'string' ||
      !('search' in parsed) ||
      typeof (parsed as { search: unknown }).search !== 'string'
    ) {
      return null;
    }
    const stored = parsed as StoredShellLocation;
    return {
      pathname: stored.pathname.length > 0 ? stored.pathname : '/',
      search: normalizeSearch(stored.search),
      hash: '',
    };
  } catch {
    return null;
  }
}

function persistLocation(location: ShellRouteLocation): void {
  try {
    const payload: StoredShellLocation = {
      version: 1,
      pathname: location.pathname,
      search: location.search,
    };
    sessionStorage.setItem(SHELL_LOCATION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may throw in sandboxed iframes / private mode — stay in-memory.
  }
}

/** Strip share query keys from the real window URL (consumption only; not state storage). */
export function stripSessionShareSearchFromWindow(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  writeSessionShareSearch(url.searchParams, {
    sessionId: null,
    agentId: null,
    tab: null,
    view: null,
    timeRange: null,
  });
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Apply a pasted share link over a stored location: pathname + share search win,
 * then the real window URL is stripped so a later reload restores from storage.
 */
function applyWindowShareOverLocation(location: ShellRouteLocation): ShellRouteLocation {
  if (typeof window === 'undefined') return location;
  const share = readSessionShareSearch(window.location.search);
  if (!hasShareParams(share)) return location;

  const defaults = resolveRoutesConfig(undefined);
  let pathname = location.pathname;
  if (share.view === 'sessions' && defaults.sessionsBrowser != null) {
    pathname = defaults.sessionsBrowser;
  } else if (share.agentId != null && defaults.libraryAgent != null) {
    pathname = defaults.libraryAgent.replace(':agentId', encodeURIComponent(share.agentId));
  }

  const params = new URLSearchParams(location.search.startsWith('?') ? location.search.slice(1) : location.search);
  writeSessionShareSearch(params, {
    sessionId: share.sessionId,
    agentId: share.agentId,
    tab: share.tab,
    view: share.view,
    timeRange: share.timeRange,
  });
  const search = params.toString();
  stripSessionShareSearchFromWindow();
  return {
    pathname,
    search: search.length > 0 ? `?${search}` : '',
    hash: '',
  };
}

export function createShellLocationStore(): ShellLocationStore {
  let location: ShellRouteLocation = applyWindowShareOverLocation(readStoredLocation() ?? { ...DEFAULT_LOCATION });
  persistLocation(location);

  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const setLocation = (next: ShellRouteLocation) => {
    const normalized: ShellRouteLocation = {
      pathname: next.pathname.length > 0 ? next.pathname : '/',
      search: normalizeSearch(next.search),
      hash: next.hash ?? '',
    };
    if (
      normalized.pathname === location.pathname &&
      normalized.search === location.search &&
      normalized.hash === location.hash
    ) {
      return;
    }
    location = normalized;
    persistLocation(location);
    notify();
  };

  return {
    getLocation: () => location,
    navigate: (to, _options) => {
      setLocation({
        pathname: to.pathname,
        search: to.search,
        hash: to.hash ?? '',
      });
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateSearch: next => {
      const params = new URLSearchParams(location.search.startsWith('?') ? location.search.slice(1) : location.search);
      writeSessionShareSearch(params, next);
      const search = params.toString();
      setLocation({
        pathname: location.pathname,
        search: search.length > 0 ? `?${search}` : '',
        hash: location.hash,
      });
      return location.search;
    },
  };
}

/** Clear persisted shell location — tests only. */
export function clearShellLocationStorage(): void {
  try {
    sessionStorage.removeItem(SHELL_LOCATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
