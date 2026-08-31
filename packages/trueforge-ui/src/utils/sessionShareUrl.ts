export const SESSION_ID_QUERY = 'sessionId';
export const AGENT_ID_QUERY = 'agentId';
export const AGENT_TAB_QUERY = 'tab';
export const SESSIONS_VIEW_QUERY = 'view';
export const SESSIONS_VIEW_VALUE = 'sessions';
export const SESSION_START_TIME_QUERY = 's_sts';
export const SESSION_END_TIME_QUERY = 's_ets';
export const SESSION_TIME_WINDOW_QUERY = 's_tw';
export const SESSION_TIME_BUFFER_MS = 5 * 60 * 1000;
export const SESSION_CUSTOM_RANGE_MAX_DAYS = 70;
export const DEFAULT_SESSION_TIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type LibraryAgentTab = 'overview' | 'sessions' | 'code';

export type SessionTimeRange = {
  startTs: number;
  endTs: number;
  timeWindowMs?: number;
};

export type SessionShareSearch = {
  sessionId: string | null;
  agentId: string | null;
  tab: LibraryAgentTab | null;
  view: typeof SESSIONS_VIEW_VALUE | null;
  timeRange: SessionTimeRange | null;
};

export type SessionShareWrite = {
  sessionId?: string | null;
  agentId?: string | null;
  tab?: LibraryAgentTab | null;
  view?: typeof SESSIONS_VIEW_VALUE | null;
  timeRange?: SessionTimeRange | null;
};

function parseLibraryAgentTab(value: string | null): LibraryAgentTab | null {
  if (value === 'overview' || value === 'sessions' || value === 'code') return value;
  return null;
}

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

function parseMs(value: string | null): number | null {
  if (value == null || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function defaultSessionTimeRange(now = Date.now()): SessionTimeRange {
  return {
    startTs: now - DEFAULT_SESSION_TIME_WINDOW_MS,
    endTs: now,
    timeWindowMs: DEFAULT_SESSION_TIME_WINDOW_MS,
  };
}

export function sessionTimeRangeFromCreatedAt(createdAt: string): SessionTimeRange | null {
  const createdAtMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdAtMs)) return null;
  return {
    startTs: createdAtMs - SESSION_TIME_BUFFER_MS,
    endTs: createdAtMs + SESSION_TIME_BUFFER_MS,
  };
}

export function resolveSessionTimeRange(range: SessionTimeRange, now = Date.now()): { startTs: number; endTs: number } {
  if (range.timeWindowMs != null) {
    return { startTs: now - range.timeWindowMs, endTs: now };
  }
  return { startTs: range.startTs, endTs: range.endTs };
}

export function readSessionShareSearch(search: string): SessionShareSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const startTs = parseMs(params.get(SESSION_START_TIME_QUERY));
  const endTs = parseMs(params.get(SESSION_END_TIME_QUERY));
  const timeWindowMs = parseMs(params.get(SESSION_TIME_WINDOW_QUERY));
  const view = params.get(SESSIONS_VIEW_QUERY);
  return {
    sessionId: nonEmpty(params.get(SESSION_ID_QUERY)),
    agentId: nonEmpty(params.get(AGENT_ID_QUERY)),
    tab: parseLibraryAgentTab(params.get(AGENT_TAB_QUERY)),
    view: view === SESSIONS_VIEW_VALUE ? SESSIONS_VIEW_VALUE : null,
    timeRange:
      startTs != null && endTs != null
        ? { startTs, endTs }
        : timeWindowMs != null
          ? { startTs: Date.now() - timeWindowMs, endTs: Date.now(), timeWindowMs }
          : null,
  };
}

/** Library details tab: `tab=` wins; a matching share `sessionId` still opens Sessions. */
export function libraryAgentTabFromSearch(share: SessionShareSearch, agentId: string): LibraryAgentTab {
  if (share.tab != null) return share.tab;
  return share.sessionId != null && share.agentId === agentId ? 'sessions' : 'overview';
}

export function writeSessionShareSearch(params: URLSearchParams, next: SessionShareWrite): void {
  if (next.sessionId === null) params.delete(SESSION_ID_QUERY);
  else if (next.sessionId != null) params.set(SESSION_ID_QUERY, next.sessionId);
  if (next.agentId === null) params.delete(AGENT_ID_QUERY);
  else if (next.agentId != null) params.set(AGENT_ID_QUERY, next.agentId);
  if (next.tab === null) params.delete(AGENT_TAB_QUERY);
  else if (next.tab != null) params.set(AGENT_TAB_QUERY, next.tab);
  if (next.view === null) params.delete(SESSIONS_VIEW_QUERY);
  else if (next.view != null) params.set(SESSIONS_VIEW_QUERY, next.view);
  if (next.timeRange === null) {
    params.delete(SESSION_START_TIME_QUERY);
    params.delete(SESSION_END_TIME_QUERY);
    params.delete(SESSION_TIME_WINDOW_QUERY);
  } else if (next.timeRange != null) {
    if (next.timeRange.timeWindowMs != null) {
      params.set(SESSION_TIME_WINDOW_QUERY, String(next.timeRange.timeWindowMs));
      params.delete(SESSION_START_TIME_QUERY);
      params.delete(SESSION_END_TIME_QUERY);
    } else {
      params.set(SESSION_START_TIME_QUERY, String(next.timeRange.startTs));
      params.set(SESSION_END_TIME_QUERY, String(next.timeRange.endTs));
      params.delete(SESSION_TIME_WINDOW_QUERY);
    }
  }
}

/** Share link for a library or global session. Works with or without `withRouter`. */
export function buildAgentSessionShareUrl({
  sessionId,
  agentId,
  createdAt,
  view,
  href = typeof window === 'undefined' ? '' : window.location.href,
}: {
  sessionId: string;
  agentId?: string;
  createdAt?: string;
  view?: typeof SESSIONS_VIEW_VALUE | null;
  href?: string;
}): string {
  const url = new URL(href);
  writeSessionShareSearch(url.searchParams, {
    sessionId,
    agentId: agentId == null || agentId.length === 0 ? null : agentId,
    ...(view === undefined ? {} : { view }),
    timeRange: createdAt == null ? undefined : sessionTimeRangeFromCreatedAt(createdAt),
  });
  return url.toString();
}

export const SESSION_SHARE_CHANGE_EVENT = 'trueforge-session-share';

export function replaceSessionShareSearch(next: SessionShareWrite): string {
  const url = new URL(window.location.href);
  writeSessionShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(SESSION_SHARE_CHANGE_EVENT));
  return url.search;
}
