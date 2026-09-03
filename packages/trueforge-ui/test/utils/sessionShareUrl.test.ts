import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  DEFAULT_SESSION_TIME_WINDOW_MS,
  defaultSessionTimeRange,
  libraryAgentTabFromSearch,
  readSessionShareSearch,
  SESSION_TIME_BUFFER_MS,
  sessionTimeRangeFromCreatedAt,
  writeSessionShareSearch,
} from '@/utils/sessionShareUrl.js';

describe('sessionShareUrl', () => {
  it('reads agent and session ids from the query string', () => {
    assert.deepEqual(readSessionShareSearch('?sessionId=sess-1&agentId=agent-1'), {
      sessionId: 'sess-1',
      agentId: 'agent-1',
      tab: null,
      view: null,
      timeRange: null,
    });
    assert.deepEqual(readSessionShareSearch(''), {
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: null,
    });
  });

  it('reads view=sessions and a relative time window', () => {
    const share = readSessionShareSearch(`?view=sessions&s_tw=${String(DEFAULT_SESSION_TIME_WINDOW_MS)}`);
    assert.equal(share.view, 'sessions');
    assert.equal(share.timeRange?.timeWindowMs, DEFAULT_SESSION_TIME_WINDOW_MS);
    assert.ok(
      share.timeRange != null && share.timeRange.endTs - share.timeRange.startTs === DEFAULT_SESSION_TIME_WINDOW_MS,
    );
  });

  it('reads an absolute pinned time range', () => {
    assert.deepEqual(readSessionShareSearch('?s_sts=1000&s_ets=2000'), {
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: { startTs: 1000, endTs: 2000 },
    });
  });

  it('writes and clears share params without dropping host query keys', () => {
    const params = new URLSearchParams('theme=dark');
    writeSessionShareSearch(params, { sessionId: 'sess-1', agentId: 'agent-1', view: 'sessions' });
    assert.equal(params.get('theme'), 'dark');
    assert.equal(params.get('sessionId'), 'sess-1');
    assert.equal(params.get('view'), 'sessions');
    writeSessionShareSearch(params, { sessionId: null, view: null });
    assert.equal(params.get('sessionId'), null);
    assert.equal(params.get('view'), null);
    assert.equal(params.get('agentId'), 'agent-1');
  });

  it('writes a relative window and replaces it with a pinned range', () => {
    const params = new URLSearchParams();
    writeSessionShareSearch(params, {
      timeRange: { startTs: 1, endTs: 2, timeWindowMs: DEFAULT_SESSION_TIME_WINDOW_MS },
    });
    assert.equal(params.get('s_tw'), String(DEFAULT_SESSION_TIME_WINDOW_MS));
    assert.equal(params.get('s_sts'), null);
    writeSessionShareSearch(params, { timeRange: { startTs: 10, endTs: 20 } });
    assert.equal(params.get('s_sts'), '10');
    assert.equal(params.get('s_ets'), '20');
    assert.equal(params.get('s_tw'), null);
  });

  it('pins a 5 minute buffer around created_at', () => {
    const createdAt = '2026-01-01T00:10:00.000Z';
    const createdAtMs = Date.parse(createdAt);
    assert.deepEqual(sessionTimeRangeFromCreatedAt(createdAt), {
      startTs: createdAtMs - SESSION_TIME_BUFFER_MS,
      endTs: createdAtMs + SESSION_TIME_BUFFER_MS,
    });
  });

  it('defaults the sessions filter to the last 30 days', () => {
    const now = 1_700_000_000_000;
    assert.deepEqual(defaultSessionTimeRange(now), {
      startTs: now - DEFAULT_SESSION_TIME_WINDOW_MS,
      endTs: now,
      timeWindowMs: DEFAULT_SESSION_TIME_WINDOW_MS,
    });
  });

  it('resolves the library details tab from tab= then a matching session share', () => {
    const share = readSessionShareSearch('?sessionId=sess-1&agentId=agent-1');
    assert.equal(libraryAgentTabFromSearch(share, 'agent-1'), 'sessions');
    assert.equal(libraryAgentTabFromSearch(share, 'other-agent'), 'overview');
    assert.equal(
      libraryAgentTabFromSearch(readSessionShareSearch('?sessionId=sess-1&tab=overview'), 'agent-1'),
      'overview',
    );
    assert.equal(libraryAgentTabFromSearch(readSessionShareSearch('?tab=code'), 'agent-1'), 'code');
    assert.equal(libraryAgentTabFromSearch(readSessionShareSearch('?tab=metrics'), 'agent-1'), 'metrics');
  });
});
