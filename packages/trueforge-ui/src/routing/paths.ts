import { clearScheduleShareSearch } from '../utils/scheduleShareUrl.js';
import { readSessionShareSearch, writeSessionShareSearch } from '../utils/sessionShareUrl.js';
import type { ResolvedRoutes, RoutePlace, RoutesConfig } from './types.js';

const DEFAULTS = {
  root: '/',
  settings: '/settings',
  library: '/library',
  libraryAgent: '/library/:agentId',
  schedules: '/schedules',
  agent: '/agents/:agentName',
  session: '/sessions/:sessionId',
  sessionsBrowser: '/sessions',
} as const;

function normalizePath(path: string): string {
  const trimmed = path.trim();
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  // Drop a trailing slash except for the root itself.
  return withLead.length > 1 && withLead.endsWith('/') ? withLead.slice(0, -1) : withLead;
}

function resolveOptional(value: string | false | undefined, fallback: string): string | null {
  if (value === false) return null;
  return normalizePath(value ?? fallback);
}

export function resolveRoutesConfig(routes?: RoutesConfig): ResolvedRoutes {
  const paths = routes?.paths;
  return {
    basename: routes?.basename ?? '',
    root: normalizePath(paths?.root ?? DEFAULTS.root),
    settings: resolveOptional(paths?.settings, DEFAULTS.settings),
    library: resolveOptional(paths?.library, DEFAULTS.library),
    libraryAgent: resolveOptional(paths?.libraryAgent, DEFAULTS.libraryAgent),
    schedules: resolveOptional(paths?.schedules, DEFAULTS.schedules),
    agent: resolveOptional(paths?.agent, DEFAULTS.agent),
    session: resolveOptional(paths?.session, DEFAULTS.session),
    sessionsBrowser: resolveOptional(paths?.sessionsBrowser, DEFAULTS.sessionsBrowser),
  };
}

function splitSegments(path: string): string[] {
  return path.split('/').filter(segment => segment.length > 0);
}

/** Fill a single-param template (`/agents/:agentName`) with an encoded value. */
function fillTemplate(template: string, value: string): string {
  return (
    '/' +
    splitSegments(template)
      .map(segment => (segment.startsWith(':') ? encodeURIComponent(value) : segment))
      .join('/')
  );
}

/** Build the URL path for a place, or `null` when that place has no configured route. */
export function buildPath(place: RoutePlace, routes: ResolvedRoutes): string | null {
  switch (place.type) {
    case 'root':
      return routes.root;
    case 'settings':
      return routes.settings;
    case 'library':
      return routes.library;
    case 'libraryAgent':
      return routes.libraryAgent == null ? null : fillTemplate(routes.libraryAgent, place.agentId);
    case 'schedules':
      return routes.schedules;
    case 'agent':
      return routes.agent == null ? null : fillTemplate(routes.agent, place.agentName);
    case 'session':
      return routes.session == null ? null : fillTemplate(routes.session, place.sessionId);
    case 'sessionsBrowser':
      return routes.sessionsBrowser;
  }
}

/**
 * Absolute href that boots the shell on a history session (`/sessions/:id`).
 * Includes `routes.basename` and clears place-owned share query keys.
 */
export function buildSessionResumeHref({
  sessionId,
  routes,
  href = typeof window === 'undefined' ? 'http://localhost/' : window.location.href,
}: {
  sessionId: string;
  routes: ResolvedRoutes;
  href?: string;
}): string | null {
  const sessionPath = buildPath({ type: 'session', sessionId }, routes);
  if (sessionPath == null) return null;
  const url = new URL(href);
  const basename = routes.basename.endsWith('/') ? routes.basename.slice(0, -1) : routes.basename;
  url.pathname = `${basename}${sessionPath}` || '/';
  url.search = sanitizeSearchForPlace({ type: 'session', sessionId }, url.search);
  url.hash = '';
  return url.toString();
}

/**
 * Remove query state owned by a different shell place while preserving host
 * parameters. Settings is an overlay, so it retains the underlying place state.
 */
export function sanitizeSearchForPlace(place: RoutePlace, search: string): string {
  if (place.type === 'settings') return search;

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (place.type === 'sessionsBrowser') {
    writeSessionShareSearch(params, { tab: null });
    clearScheduleShareSearch(params);
  } else if (place.type === 'libraryAgent') {
    const share = readSessionShareSearch(search);
    writeSessionShareSearch(params, {
      view: null,
      timeRange: null,
      ...(share.sessionId != null && share.agentId !== place.agentId ? { sessionId: null, agentId: null } : {}),
    });
    clearScheduleShareSearch(params);
  } else if (place.type === 'schedules') {
    writeSessionShareSearch(params, {
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: null,
    });
    // Keep `agent` / `status` / `q` — owned by the schedules place.
  } else {
    writeSessionShareSearch(params, {
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: null,
    });
    clearScheduleShareSearch(params);
  }
  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

/** Percent-decode a segment; `null` when the URL carries a malformed escape. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Match a single-param template against concrete segments; returns the decoded param or null. */
function matchTemplate(template: string, segments: string[]): string | null {
  const templateSegments = splitSegments(template);
  if (templateSegments.length !== segments.length) return null;
  let param: string | null = null;
  for (const [i, tpl] of templateSegments.entries()) {
    const seg = segments[i];
    if (seg === undefined) return null;
    if (tpl.startsWith(':')) {
      // A malformed escape is an unusable id, so the path simply does not match.
      const decoded = decodeSegment(seg);
      if (decoded == null) return null;
      param = decoded;
    } else if (tpl !== seg) {
      return null;
    }
  }
  return param;
}

/** Parse a (basename-relative) pathname into a place, or `null` when unrecognized. */
export function matchPath(pathname: string, routes: ResolvedRoutes): RoutePlace | null {
  const normalized = normalizePath(pathname);
  const segments = splitSegments(normalized);

  if (routes.settings != null && normalized === routes.settings) {
    return { type: 'settings' };
  }
  if (routes.library != null && normalized === routes.library) {
    return { type: 'library' };
  }
  if (routes.sessionsBrowser != null && normalized === routes.sessionsBrowser) {
    return { type: 'sessionsBrowser' };
  }
  if (routes.libraryAgent != null) {
    const agentId = matchTemplate(routes.libraryAgent, segments);
    if (agentId != null) return { type: 'libraryAgent', agentId };
  }
  if (routes.schedules != null && normalized === routes.schedules) {
    return { type: 'schedules' };
  }
  if (routes.agent != null) {
    const agentName = matchTemplate(routes.agent, segments);
    if (agentName != null) return { type: 'agent', agentName };
  }
  if (routes.session != null) {
    const sessionId = matchTemplate(routes.session, segments);
    if (sessionId != null) return { type: 'session', sessionId };
  }
  if (normalized === routes.root) {
    return { type: 'root' };
  }
  return null;
}

/** Pathname place, or library agent from `?agentId=` when the path is root. */
export function matchLocation({
  pathname,
  search,
  routes,
}: {
  pathname: string;
  search: string;
  routes: ResolvedRoutes;
}): RoutePlace | null {
  const matched = matchPath(pathname, routes);
  if (matched == null || matched.type !== 'root') return matched;
  const { agentId } = readSessionShareSearch(search);
  return agentId != null ? { type: 'libraryAgent', agentId } : matched;
}

export function placesEqual(a: RoutePlace, b: RoutePlace): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'agent' && b.type === 'agent') return a.agentName === b.agentName;
  if (a.type === 'libraryAgent' && b.type === 'libraryAgent') return a.agentId === b.agentId;
  if (a.type === 'session' && b.type === 'session') return a.sessionId === b.sessionId;
  return true;
}
