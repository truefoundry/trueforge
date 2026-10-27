export const LIBRARY_AGENT_NAME_QUERY = 'agent_name';

export const LIBRARY_SHARE_CHANGE_EVENT = 'trueforge-library-share';

export type LibraryShareSearch = {
  /** Agent name search; `null` when empty. */
  agentName: string | null;
};

export type LibraryShareWrite = {
  agentName?: string | null;
};

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

export function readLibraryShareSearch(search: string): LibraryShareSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    agentName: nonEmpty(params.get(LIBRARY_AGENT_NAME_QUERY)),
  };
}

export function writeLibraryShareSearch(params: URLSearchParams, next: LibraryShareWrite): void {
  if (next.agentName === null) params.delete(LIBRARY_AGENT_NAME_QUERY);
  else if (next.agentName != null) params.set(LIBRARY_AGENT_NAME_QUERY, next.agentName);
}

/** Drop library-owned query keys (used when leaving the library place). */
export function clearLibraryShareSearch(params: URLSearchParams): void {
  params.delete(LIBRARY_AGENT_NAME_QUERY);
}

export function replaceLibraryShareSearch(next: LibraryShareWrite): string {
  const url = new URL(window.location.href);
  writeLibraryShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(LIBRARY_SHARE_CHANGE_EVENT));
  return url.search;
}
