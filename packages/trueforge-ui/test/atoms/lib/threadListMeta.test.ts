import { describe, expect, it } from 'vitest';

import {
  canReuseMutableShell,
  formatRelativeShort,
  isRunningTurnStatus,
  lastTurnStatusDotClass,
  lastTurnStatusLabel,
  readThreadAgentName,
  readThreadIsMutable,
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
  it('maps paused and error; hides running, cancelled, and done', () => {
    expect(lastTurnStatusDotClass('paused')).toBe('bg-warning-bg');
    expect(lastTurnStatusDotClass('error')).toBe('bg-failure-bg');
    expect(lastTurnStatusDotClass('cancelled')).toBeUndefined();
    expect(lastTurnStatusDotClass('running')).toBeUndefined();
    expect(lastTurnStatusDotClass('done')).toBeUndefined();
    expect(lastTurnStatusDotClass(null)).toBeUndefined();
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
    expect(threadCustomWithLastTurnStatus(undefined, 'error')).toEqual({ lastTurnStatus: 'error' });
  });

  it('normalizes non-record custom values', () => {
    expect(threadCustomWithLastTurnStatus(null, 'running')).toEqual({ lastTurnStatus: 'running' });
    expect(threadCustomWithLastTurnStatus(['nope'], 'paused')).toEqual({ lastTurnStatus: 'paused' });
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
});
