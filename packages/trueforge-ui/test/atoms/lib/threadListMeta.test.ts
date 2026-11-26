import { describe, expect, it } from 'vitest';

import {
  canReuseMutableShell,
  formatRelativeShort,
  isNewerActivityAt,
  isRunningTurnStatus,
  lastTurnStatusDotClass,
  lastTurnStatusLabel,
  laterActivityAt,
  PAUSED_STATUS_DOT_MAX_AGE_MS,
  readThreadAgentName,
  readThreadIsCreateAgent,
  readThreadIsMutable,
  readThreadLastActivityAt,
  readThreadLastTurnStatus,
  threadCustomWithLastTurnStatus,
  threadListIndicesByRecency,
  threadListItemIsMutable,
} from '@/atoms/lib/threadListMeta.js';

describe('formatRelativeShort', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('formats minutes, hours, and days', () => {
    expect(formatRelativeShort(new Date('2026-08-06T11:30:00.000Z'), now)).toBe('30m');
    expect(formatRelativeShort(new Date('2026-08-05T14:00:00.000Z'), now)).toBe('22h');
    expect(formatRelativeShort(new Date('2026-08-05T12:00:00.000Z'), now)).toBe('1d');
  });
});

describe('readThreadAgentName', () => {
  it('reads agentName from custom metadata', () => {
    expect(readThreadAgentName({ agentName: 'from-sdk' })).toBe('from-sdk');
    expect(readThreadAgentName({})).toBeUndefined();
    expect(readThreadAgentName(null)).toBeUndefined();
    expect(readThreadAgentName({ agentName: 1 })).toBeUndefined();
  });
});

describe('readThreadLastTurnStatus', () => {
  it('reads a valid lastTurnStatus from custom metadata', () => {
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'running' })).toBe('running');
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'paused' })).toBe('paused');
    expect(readThreadLastTurnStatus({})).toBeUndefined();
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'nope' })).toBeUndefined();
  });
});

describe('lastTurnStatusDotClass', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');

  it('maps recent paused; hides stale paused, error, running, cancelled, and done', () => {
    expect(
      lastTurnStatusDotClass({
        status: 'paused',
        activityAt: new Date(now.getTime() - PAUSED_STATUS_DOT_MAX_AGE_MS),
        now,
      }),
    ).toBe('bg-warning-bg');
    expect(
      lastTurnStatusDotClass({
        status: 'paused',
        activityAt: new Date(now.getTime() - PAUSED_STATUS_DOT_MAX_AGE_MS - 1),
        now,
      }),
    ).toBeUndefined();
    expect(lastTurnStatusDotClass({ status: 'paused', now })).toBe('bg-warning-bg');
    expect(lastTurnStatusDotClass({ status: 'paused', activityAt: new Date('invalid'), now })).toBe('bg-warning-bg');
    expect(lastTurnStatusDotClass({ status: 'error', now })).toBeUndefined();
    expect(lastTurnStatusDotClass({ status: 'cancelled', now })).toBeUndefined();
    expect(lastTurnStatusDotClass({ status: 'running', now })).toBeUndefined();
    expect(lastTurnStatusDotClass({ status: 'done', now })).toBeUndefined();
    expect(lastTurnStatusDotClass({ status: null, now })).toBeUndefined();
  });
});

describe('lastTurnStatusLabel', () => {
  it('labels running, paused, and error for screen readers', () => {
    expect(lastTurnStatusLabel('running')).toBe('Running');
    expect(lastTurnStatusLabel('paused')).toBe('Waiting for input');
    expect(lastTurnStatusLabel('error')).toBe('Failed');
    expect(lastTurnStatusLabel('cancelled')).toBeUndefined();
    expect(lastTurnStatusLabel('done')).toBeUndefined();
  });
});

describe('isRunningTurnStatus', () => {
  it('is true only for running', () => {
    expect(isRunningTurnStatus('running')).toBe(true);
    expect(isRunningTurnStatus('paused')).toBe(false);
    expect(isRunningTurnStatus(undefined)).toBe(false);
  });
});

describe('threadCustomWithLastTurnStatus', () => {
  it('sets, replaces, and clears lastTurnStatus without mutating the input', () => {
    const custom = { isMutable: true, lastTurnStatus: 'running' };
    expect(threadCustomWithLastTurnStatus(custom, 'paused')).toEqual({
      isMutable: true,
      lastTurnStatus: 'paused',
    });
    expect(custom).toEqual({ isMutable: true, lastTurnStatus: 'running' });
    expect(threadCustomWithLastTurnStatus(custom, null)).toEqual({ isMutable: true });
    expect(threadCustomWithLastTurnStatus(custom, 'paused', '2026-11-16T00:00:00.000Z')).toEqual({
      isMutable: true,
      lastTurnStatus: 'paused',
      lastActivityAt: '2026-11-16T00:00:00.000Z',
    });
    expect(threadCustomWithLastTurnStatus(undefined, 'error')).toEqual({ lastTurnStatus: 'error' });
  });

  it('normalizes non-record custom values', () => {
    expect(threadCustomWithLastTurnStatus(null, 'running')).toEqual({ lastTurnStatus: 'running' });
    expect(threadCustomWithLastTurnStatus(['nope'], 'paused')).toEqual({ lastTurnStatus: 'paused' });
  });
});

describe('readThreadLastActivityAt', () => {
  it('reads a valid poll stamp and ignores anything else', () => {
    expect(readThreadLastActivityAt({ lastActivityAt: '2026-11-16T00:00:00.000Z' })?.toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    expect(readThreadLastActivityAt({ lastActivityAt: 'nope' })).toBeUndefined();
    expect(readThreadLastActivityAt({})).toBeUndefined();
  });

  it('treats a later stamp as newer and prefers it over the list payload', () => {
    const older = new Date('2026-11-01T00:00:00.000Z');
    const newer = new Date('2026-11-16T00:00:00.000Z');
    expect(isNewerActivityAt('2026-11-16T00:00:00.000Z', older)).toBe(true);
    expect(isNewerActivityAt('2026-11-01T00:00:00.000Z', newer)).toBe(false);
    expect(isNewerActivityAt('nope', older)).toBe(false);
    expect(laterActivityAt(older, newer)).toBe(newer);
    expect(laterActivityAt(newer, undefined)).toBe(newer);
  });
});

describe('threadListItemIsMutable', () => {
  it('prefers custom.isMutable over agentName presence', () => {
    expect(readThreadIsMutable({ isMutable: false })).toBe(false);
    expect(threadListItemIsMutable({ isMutable: false })).toBe(false);
    // Orphaned named ref: no agentName, but still immutable on the wire.
    expect(threadListItemIsMutable({ isMutable: false })).toBe(false);
    expect(threadListItemIsMutable({ isMutable: true, agentName: 'x' })).toBe(true);
  });

  it('falls back to agentName heuristic when isMutable is absent', () => {
    expect(threadListItemIsMutable({ agentName: 'from-sdk' })).toBe(false);
    expect(threadListItemIsMutable({})).toBe(true);
    expect(threadListItemIsMutable(null)).toBe(true);
  });
});

describe('threadListIndicesByRecency', () => {
  it('orders by lastMessageAt newest-first even when ids were appended', () => {
    const older = new Date('2026-08-06T11:00:00.000Z');
    const newer = new Date('2026-08-06T12:00:00.000Z');
    // Selected session appended at end (assistant-ui switchToThread fetch race).
    expect(
      threadListIndicesByRecency({
        threadIds: ['older', 'newer-appended'],
        threadItems: [
          { id: 'older', remoteId: 'older', lastMessageAt: older },
          { id: 'newer-appended', remoteId: 'newer-appended', lastMessageAt: newer },
        ],
      }),
    ).toEqual([1, 0]);
  });

  it('moves a row above later-loaded chats when lastActivityAt is newer', () => {
    const loadedLater = new Date('2026-08-06T12:00:00.000Z');
    const loadedEarlier = new Date('2026-08-06T10:00:00.000Z');
    expect(
      threadListIndicesByRecency({
        threadIds: ['first', 'fifth'],
        threadItems: [
          { id: 'first', remoteId: 'first', lastMessageAt: loadedLater },
          {
            id: 'fifth',
            remoteId: 'fifth',
            lastMessageAt: loadedEarlier,
            custom: { lastActivityAt: '2026-08-06T13:00:00.000Z' },
          },
        ],
      }),
    ).toEqual([1, 0]);
  });

  it('pins threads without lastMessageAt above dated history (empty New Chat)', () => {
    const older = new Date('2026-08-06T11:00:00.000Z');
    const newer = new Date('2026-08-06T12:00:00.000Z');
    // Local new thread appended at end with no timestamp.
    expect(
      threadListIndicesByRecency({
        threadIds: ['older', 'newer', 'new-chat'],
        threadItems: [
          { id: 'older', remoteId: 'older', lastMessageAt: older },
          { id: 'newer', remoteId: 'newer', lastMessageAt: newer },
          { id: 'new-chat', remoteId: null, lastMessageAt: undefined },
        ],
      }),
    ).toEqual([2, 1, 0]);
  });
});

describe('readThreadIsCreateAgent', () => {
  it('reads builder intent from custom.metadata', () => {
    expect(readThreadIsCreateAgent({ metadata: { 'tfg.is_create_agent': 'true' } })).toBe(true);
    expect(readThreadIsCreateAgent({ metadata: { 'tfg.is_create_agent': 'false' } })).toBe(false);
    expect(readThreadIsCreateAgent({ metadata: { is_create_agent: 'true' } })).toBe(true);
    expect(readThreadIsCreateAgent({ isMutable: true })).toBe(false);
    expect(readThreadIsCreateAgent(null)).toBe(false);
  });
});

describe('canReuseMutableShell', () => {
  it('allows blank drafts to share the mutable shell', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(true);
  });

  it('blocks Edit-bound shells from reusing chrome on a different session', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        shellAgentName: 'writer',
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(false);
  });

  it('allows Edit-bound shells to switchToThread for their pending session', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        shellAgentName: 'writer',
        remoteId: 'sess-a',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(true);
  });

  it('blocks reuse when builder vs normal chat flags differ', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        sessionIsCreateAgent: true,
        shellIsCreateAgent: false,
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(false);
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        sessionIsCreateAgent: false,
        shellIsCreateAgent: true,
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(false);
  });

  it('allows reuse when both sides are builder chats', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        sessionIsCreateAgent: true,
        shellIsCreateAgent: true,
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(true);
  });
});
