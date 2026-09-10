import type { ScheduleStatus } from '../server/types.js';
import { writeSessionShareSearch } from './sessionShareUrl.js';

export const SCHEDULE_AGENT_QUERY = 'agent';
export const SCHEDULE_STATUS_QUERY = 'status';
export const SCHEDULE_NAME_QUERY = 'q';
export const SCHEDULE_IS_NEW_QUERY = 'isNew';

export const SCHEDULE_SHARE_CHANGE_EVENT = 'trueforge-schedule-share';

export type ScheduleShareSearch = {
  /** Agent id filter; `null` means all agents. */
  agent: string | null;
  /** Status filter; `null` means all statuses. */
  status: ScheduleStatus | null;
  /** Name search; `null` when empty. */
  q: string | null;
  /** One-shot flag to open the create schedule drawer. */
  isNew: boolean;
};

export type ScheduleShareWrite = {
  agent?: string | null;
  status?: ScheduleStatus | null;
  q?: string | null;
  isNew?: boolean | null;
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
    isNew: params.get(SCHEDULE_IS_NEW_QUERY) === 'true',
  };
}

export function writeScheduleShareSearch(params: URLSearchParams, next: ScheduleShareWrite): void {
  if (next.agent === null) params.delete(SCHEDULE_AGENT_QUERY);
  else if (next.agent != null) params.set(SCHEDULE_AGENT_QUERY, next.agent);
  if (next.status === null) params.delete(SCHEDULE_STATUS_QUERY);
  else if (next.status != null) params.set(SCHEDULE_STATUS_QUERY, next.status);
  if (next.q === null) params.delete(SCHEDULE_NAME_QUERY);
  else if (next.q != null) params.set(SCHEDULE_NAME_QUERY, next.q);
  if (next.isNew === null || next.isNew === false) params.delete(SCHEDULE_IS_NEW_QUERY);
  else if (next.isNew === true) params.set(SCHEDULE_IS_NEW_QUERY, 'true');
}

/** Drop all schedules-owned query keys (used when leaving the schedules place). */
export function clearScheduleShareSearch(params: URLSearchParams): void {
  params.delete(SCHEDULE_AGENT_QUERY);
  params.delete(SCHEDULE_STATUS_QUERY);
  params.delete(SCHEDULE_NAME_QUERY);
  params.delete(SCHEDULE_IS_NEW_QUERY);
}

export function replaceScheduleShareSearch(next: ScheduleShareWrite): string {
  const url = new URL(window.location.href);
  writeScheduleShareSearch(url.searchParams, next);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(SCHEDULE_SHARE_CHANGE_EVENT));
  return url.search;
}

/**
 * Point the address bar at schedules filtered to `agentId` (clears library agent
 * share keys). Caller still opens the schedules place via shell.
 */
export function writeOpenSchedulesForAgentSearch({ agentId, isNew }: { agentId: string; isNew?: boolean }): void {
  const url = new URL(window.location.href);
  writeSessionShareSearch(url.searchParams, {
    sessionId: null,
    agentId: null,
    tab: null,
    view: null,
    timeRange: null,
  });
  writeScheduleShareSearch(url.searchParams, {
    agent: agentId,
    status: null,
    q: null,
    isNew: isNew === true ? true : null,
  });
  window.history.replaceState(window.history.state, '', url);
}
