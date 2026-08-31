export const SESSION_ID_QUERY = 'sessionId';
export const AGENT_ID_QUERY = 'agentId';

export type SessionShareSearch = {
  sessionId: string | null;
  agentId: string | null;
};

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

export function readSessionShareSearch(search: string): SessionShareSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    sessionId: nonEmpty(params.get(SESSION_ID_QUERY)),
    agentId: nonEmpty(params.get(AGENT_ID_QUERY)),
  };
}

export function writeSessionShareSearch(
  params: URLSearchParams,
  next: { sessionId?: string | null; agentId?: string | null },
): void {
  if (next.sessionId === null) params.delete(SESSION_ID_QUERY);
  else if (next.sessionId != null) params.set(SESSION_ID_QUERY, next.sessionId);
  if (next.agentId === null) params.delete(AGENT_ID_QUERY);
  else if (next.agentId != null) params.set(AGENT_ID_QUERY, next.agentId);
}

/** Share link for a library session. Works with or without `withRouter`. */
export function buildAgentSessionShareUrl({
  sessionId,
  agentId,
  href = typeof window === 'undefined' ? '' : window.location.href,
}: {
  sessionId: string;
  agentId: string;
  href?: string;
}): string {
  const url = new URL(href);
  writeSessionShareSearch(url.searchParams, { sessionId, agentId });
  return url.toString();
}

export function replaceSessionShareSearch(next: { sessionId?: string | null; agentId?: string | null }): string {
  const url = new URL(window.location.href);
  writeSessionShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  return url.search;
}
