/** Distinct from schedules `q` / `isNew` so places do not clobber each other. */
export const ENVIRONMENT_NAME_QUERY = 'envQ';
export const ENVIRONMENT_IS_NEW_QUERY = 'envIsNew';

export const ENVIRONMENT_SHARE_CHANGE_EVENT = 'trueforge-environment-share';

export type EnvironmentShareSearch = {
  /** Name search; `null` when empty. */
  q: string | null;
  /** One-shot flag to open the create environment drawer. */
  isNew: boolean;
};

export type EnvironmentShareWrite = {
  q?: string | null;
  isNew?: boolean | null;
};

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

export function readEnvironmentShareSearch(search: string): EnvironmentShareSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    q: nonEmpty(params.get(ENVIRONMENT_NAME_QUERY)),
    isNew: params.get(ENVIRONMENT_IS_NEW_QUERY) === 'true',
  };
}

export function writeEnvironmentShareSearch(params: URLSearchParams, next: EnvironmentShareWrite): void {
  if (next.q === null) params.delete(ENVIRONMENT_NAME_QUERY);
  else if (next.q != null) params.set(ENVIRONMENT_NAME_QUERY, next.q);
  if (next.isNew === null || next.isNew === false) params.delete(ENVIRONMENT_IS_NEW_QUERY);
  else if (next.isNew === true) params.set(ENVIRONMENT_IS_NEW_QUERY, 'true');
}

/** Drop all environments-owned query keys (used when leaving the environments place). */
export function clearEnvironmentShareSearch(params: URLSearchParams): void {
  params.delete(ENVIRONMENT_NAME_QUERY);
  params.delete(ENVIRONMENT_IS_NEW_QUERY);
}

export function replaceEnvironmentShareSearch(next: EnvironmentShareWrite): string {
  const url = new URL(window.location.href);
  writeEnvironmentShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(ENVIRONMENT_SHARE_CHANGE_EVENT));
  return url.search;
}
