import type { TurnStatus } from '../../server/types.js';

/** Matches thread-list / AgentSessions first-page `limit`. */
export const SESSION_LIST_FIRST_PAGE_LIMIT = 20;

/** Cadence while any listed row is running or paused. */
export const SESSION_LIST_POLL_INTERVAL_MS = 5_000;

/** Poll interval for live last-turn status, or `null` when nothing needs polling. */
export function sessionListPollIntervalMs(statuses: ReadonlyArray<TurnStatus | undefined | null>): number | null {
  for (const status of statuses) {
    if (status === 'running' || status === 'paused') return SESSION_LIST_POLL_INTERVAL_MS;
  }
  return null;
}

/**
 * Patch items that appear on a first-page poll into the full loaded list by id.
 * Later pages from load-more are left in place; unknown first-page ids are ignored.
 */
export function mergeSessionListFirstPage<T extends { id: string }>({
  current,
  firstPage,
  mergeItem,
}: {
  current: T[];
  firstPage: readonly T[];
  mergeItem: (prev: T, next: T) => T;
}): T[] {
  if (firstPage.length === 0) return current;
  const byId = new Map(firstPage.map(item => [item.id, item] as const));
  let changed = false;
  const next = current.map(item => {
    const pageItem = byId.get(item.id);
    if (pageItem == null) return item;
    const merged = mergeItem(item, pageItem);
    if (merged !== item) changed = true;
    return merged;
  });
  return changed ? next : current;
}
