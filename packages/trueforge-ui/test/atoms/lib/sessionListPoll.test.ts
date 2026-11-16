import { describe, expect, it } from 'vitest';

import {
  mergePolledSessionRow,
  mergeSessionListFirstPage,
  SESSION_LIST_FIRST_PAGE_LIMIT,
  SESSION_LIST_POLL_INTERVAL_MS,
  sessionListPollIntervalMs,
} from '@/atoms/lib/sessionListPoll.js';

describe('sessionListPollIntervalMs', () => {
  it('polls while any status is running or paused', () => {
    expect(sessionListPollIntervalMs(['paused', 'running', 'done'])).toBe(SESSION_LIST_POLL_INTERVAL_MS);
    expect(sessionListPollIntervalMs(['paused', null, 'done'])).toBe(SESSION_LIST_POLL_INTERVAL_MS);
  });

  it('returns null when nothing needs polling', () => {
    expect(sessionListPollIntervalMs(['done', 'error', null])).toBeNull();
    expect(sessionListPollIntervalMs([])).toBeNull();
  });
});

describe('mergePolledSessionRow', () => {
  const paused = { id: 'turn-1', state: { status: 'paused' } };

  it('keeps the row when the turn and activity time are unchanged', () => {
    const prev = { id: 'a', lastActivityAt: '2026-11-01T00:00:00.000Z', lastTurnDetails: paused };
    expect(mergePolledSessionRow(prev, { ...prev })).toBe(prev);
  });

  it('refreshes activity time when a paused turn is touched again', () => {
    const prev = { id: 'a', lastActivityAt: '2026-11-01T00:00:00.000Z', lastTurnDetails: paused };
    const next = { ...prev, lastActivityAt: '2026-11-16T00:00:00.000Z' };
    expect(mergePolledSessionRow(prev, next)).toEqual(next);
  });

  it('copies status and activity time together', () => {
    const prev = {
      id: 'a',
      lastActivityAt: '2026-11-01T00:00:00.000Z',
      lastTurnDetails: { id: 'turn-1', state: { status: 'running' } },
    };
    const next = { ...prev, lastActivityAt: '2026-11-16T00:00:00.000Z', lastTurnDetails: paused };
    expect(mergePolledSessionRow(prev, next)).toEqual(next);
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
