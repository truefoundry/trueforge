import type { TurnStatus } from '../../server/types.js';

/** Matches thread-list / AgentSessions first-page `limit`. */
export const SESSION_LIST_FIRST_PAGE_LIMIT = 20;

/** Cadence while any listed row is running or paused. */
export const SESSION_LIST_POLL_INTERVAL_MS = 30_000;

/** Poll interval for live last-turn status, or `null` when nothing needs polling. */
export function sessionListPollIntervalMs(statuses: ReadonlyArray<TurnStatus | undefined | null>): number | null {
  for (const status of statuses) {
    if (status === 'running' || status === 'paused') return SESSION_LIST_POLL_INTERVAL_MS;
  }
  return null;
}
