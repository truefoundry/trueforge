import type { ScheduleStatus } from '../server/types.js';

export const SCHEDULE_AGENT_QUERY = 'agent';
export const SCHEDULE_STATUS_QUERY = 'status';
export const SCHEDULE_NAME_QUERY = 'q';

export const SCHEDULE_SHARE_CHANGE_EVENT = 'trueforge-schedule-share';

export type ScheduleShareSearch = {
  /** Agent id filter; `null` means all agents. */
  agent: string | null;
  /** Status filter; `null` means all statuses. */
  status: ScheduleStatus | null;
  /** Name search; `null` when empty. */
  q: string | null;
};

export type ScheduleShareWrite = {
  agent?: string | null;
  status?: ScheduleStatus | null;
  q?: string | null;
};

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

function parseStatus(value: string | null): ScheduleStatus | null {
  if (value === 'active' || value === 'paused') return value;
  return null;
}

export function readScheduleShareSearch(search: string): ScheduleShareSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    agent: nonEmpty(params.get(SCHEDULE_AGENT_QUERY)),
    status: parseStatus(params.get(SCHEDULE_STATUS_QUERY)),
    q: nonEmpty(params.get(SCHEDULE_NAME_QUERY)),
  };
}

export function writeScheduleShareSearch(params: URLSearchParams, next: ScheduleShareWrite): void {
  if (next.agent === null) params.delete(SCHEDULE_AGENT_QUERY);
  else if (next.agent != null) params.set(SCHEDULE_AGENT_QUERY, next.agent);
  if (next.status === null) params.delete(SCHEDULE_STATUS_QUERY);
  else if (next.status != null) params.set(SCHEDULE_STATUS_QUERY, next.status);
  if (next.q === null) params.delete(SCHEDULE_NAME_QUERY);
  else if (next.q != null) params.set(SCHEDULE_NAME_QUERY, next.q);
}

/** Drop all schedules-owned query keys (used when leaving the schedules place). */
export function clearScheduleShareSearch(params: URLSearchParams): void {
  params.delete(SCHEDULE_AGENT_QUERY);
  params.delete(SCHEDULE_STATUS_QUERY);
  params.delete(SCHEDULE_NAME_QUERY);
}

export function replaceScheduleShareSearch(next: ScheduleShareWrite): string {
  const url = new URL(window.location.href);
  writeScheduleShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(SCHEDULE_SHARE_CHANGE_EVENT));
  return url.search;
}
