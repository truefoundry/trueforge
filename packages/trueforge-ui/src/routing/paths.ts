import type { ResolvedRoutes, RoutePlace, RoutesConfig } from './types.js';

const DEFAULTS = {
  root: '/',
  settings: '/settings',
  agent: '/agents/:agentName',
  session: '/sessions/:sessionId',
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
    agent: resolveOptional(paths?.agent, DEFAULTS.agent),
    session: resolveOptional(paths?.session, DEFAULTS.session),
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
    case 'agent':
      return routes.agent == null ? null : fillTemplate(routes.agent, place.agentName);
    case 'session':
      return routes.session == null ? null : fillTemplate(routes.session, place.sessionId);
  }
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

export function placesEqual(a: RoutePlace, b: RoutePlace): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'agent' && b.type === 'agent') return a.agentName === b.agentName;
  if (a.type === 'session' && b.type === 'session') return a.sessionId === b.sessionId;
  return true;
}
