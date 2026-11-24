import { describe, expect, it } from 'vitest';

import { SESSION_LIST_POLL_INTERVAL_MS, sessionListPollIntervalMs } from '@/atoms/lib/sessionListPoll.js';

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
