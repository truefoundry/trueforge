import { describe, expect, it } from 'vitest';

import {
  canReuseMutableShell,
  formatRelativeShort,
  readThreadAgentName,
  readThreadIsMutable,
  threadListItemIsMutable,
} from './threadListMeta.js';

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
