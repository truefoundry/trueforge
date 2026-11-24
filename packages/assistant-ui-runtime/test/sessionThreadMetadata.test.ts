import { describe, expect, it } from 'vitest';

import type { Session } from '../src/server/index.js';
import { sessionDisplayTitle, sessionToThreadMetadata } from '../src/sessionThreadMetadata.js';

function session(partial: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T01:00:00.000Z',
    isMutable: true,
    ...partial,
  };
}

describe('sessionToThreadMetadata', () => {
  it('copies session metadata onto the thread custom field', () => {
    const result = sessionToThreadMetadata(
      session({
        id: 'builder-session',
        title: 'Builder',
        metadata: { 'tfg.is_create_agent': 'true', 'tfg.source': 'ui' },
      }),
      'Builder',
    );

    expect(result.custom).toEqual({
      isMutable: true,
      metadata: { 'tfg.is_create_agent': 'true', 'tfg.source': 'ui' },
    });
  });

  it('omits metadata when the session has none', () => {
    const result = sessionToThreadMetadata(session({ id: 'chat-session', title: 'Chat' }), 'Chat');
    expect(result.custom).toEqual({ isMutable: true });
  });

  it('omits empty metadata objects', () => {
    const result = sessionToThreadMetadata(session({ id: 'chat-session', metadata: {} }), 'Chat');
    expect(result.custom).toEqual({ isMutable: true });
  });
});

describe('sessionDisplayTitle', () => {
  it('prefers the session title for named sessions', () => {
    expect(sessionDisplayTitle(session({ id: 's1', isMutable: false, title: 'Hello', agentName: 'writer' }))).toBe(
      'Hello',
    );
  });
});
