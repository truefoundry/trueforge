import { describe, expect, it } from 'vitest';

import {
  mergeSessionListFirstPage,
  SESSION_LIST_FIRST_PAGE_LIMIT,
  SESSION_LIST_PAUSED_POLL_INTERVAL_MS,
  SESSION_LIST_RUNNING_POLL_INTERVAL_MS,
  sessionListPollIntervalMs,
} from '@/atoms/lib/sessionListPoll.js';

describe('sessionListPollIntervalMs', () => {
  it('returns the running cadence when any status is running', () => {
    expect(sessionListPollIntervalMs(['paused', 'running', 'done'])).toBe(SESSION_LIST_RUNNING_POLL_INTERVAL_MS);
  });

  it('returns the paused cadence when statuses are only paused', () => {
    expect(sessionListPollIntervalMs(['paused', null, 'done'])).toBe(SESSION_LIST_PAUSED_POLL_INTERVAL_MS);
  });

  it('returns null when nothing needs polling', () => {
    expect(sessionListPollIntervalMs(['done', 'error', null])).toBeNull();
    expect(sessionListPollIntervalMs([])).toBeNull();
  });
});

describe('mergeSessionListFirstPage', () => {
  it('patches matching ids and leaves later pages untouched', () => {
    const current = [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'running' },
      { id: 'c', status: 'running' },
    ];
    const merged = mergeSessionListFirstPage({
      current,
      firstPage: [
        { id: 'a', status: 'done' },
        { id: 'b', status: 'paused' },
      ],
      mergeItem: (prev, next) => (prev.status === next.status ? prev : { ...prev, status: next.status }),
    });

    expect(SESSION_LIST_FIRST_PAGE_LIMIT).toBe(20);
    expect(merged).toEqual([
      { id: 'a', status: 'done' },
      { id: 'b', status: 'paused' },
      { id: 'c', status: 'running' },
    ]);
    expect(merged[2]).toBe(current[2]);
  });

  it('returns the same array reference when nothing changed', () => {
    const current = [{ id: 'a', status: 'done' }];
    const merged = mergeSessionListFirstPage({
      current,
      firstPage: [{ id: 'a', status: 'done' }],
      mergeItem: (prev, next) => (prev.status === next.status ? prev : { ...prev, status: next.status }),
    });
    expect(merged).toBe(current);
  });
});
