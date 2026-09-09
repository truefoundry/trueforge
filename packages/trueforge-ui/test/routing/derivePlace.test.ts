import { describe, expect, it } from 'vitest';

import { deriveChatPlace, derivePlace } from '@/routing/derivePlace.js';
import type { ShellSnapshot } from '@/routing/types.js';

function snap(partial: Partial<ShellSnapshot>): ShellSnapshot {
  return {
    settingsOpen: false,
    libraryOpen: false,
    sessionsOpen: false,
    libraryAgentId: null,
    schedulesOpen: false,
    mode: { status: 'idle' },
    agentConfigMode: 'AgentLibraryWithComposer',
    ...partial,
  };
}

describe('derivePlace', () => {
  it('settings overlay wins over the chat place', () => {
    expect(derivePlace(snap({ settingsOpen: true, pendingSessionId: 'abc' }))).toEqual({ type: 'settings' });
  });

  it('library overlay wins over the chat place when settings is closed', () => {
    expect(derivePlace(snap({ libraryOpen: true, pendingSessionId: 'abc' }))).toEqual({ type: 'library' });
  });

  it('sessions browser wins over the chat place when settings is closed', () => {
    expect(derivePlace(snap({ sessionsOpen: true, pendingSessionId: 'abc' }))).toEqual({ type: 'sessionsBrowser' });
  });

  it('library agent detail wins over the library list and chat place', () => {
    expect(derivePlace(snap({ libraryOpen: true, libraryAgentId: 'agent-1', pendingSessionId: 'abc' }))).toEqual({
      type: 'libraryAgent',
      agentId: 'agent-1',
    });
  });

  it('settings overlay wins over library', () => {
    expect(derivePlace(snap({ settingsOpen: true, libraryOpen: true }))).toEqual({ type: 'settings' });
  });

  it('schedules overlay wins over chat when settings is closed', () => {
    expect(derivePlace(snap({ schedulesOpen: true, pendingSessionId: 'abc' }))).toEqual({ type: 'schedules' });
  });

  it('settings wins over schedules when both are open', () => {
    expect(derivePlace(snap({ settingsOpen: true, schedulesOpen: true }))).toEqual({ type: 'settings' });
  });

  it('pendingSessionId maps to a session while no thread has reported yet', () => {
    expect(derivePlace(snap({ pendingSessionId: 'abc' }))).toEqual({ type: 'session', sessionId: 'abc' });
  });

  it('activeRemoteId maps to a session when no pending id', () => {
    expect(derivePlace(snap({ activeRemoteId: 'remote-1' }))).toEqual({ type: 'session', sessionId: 'remote-1' });
  });

  it('activeRemoteId takes precedence over a stale pendingSessionId', () => {
    expect(derivePlace(snap({ pendingSessionId: 'p', activeRemoteId: 'r' }))).toEqual({
      type: 'session',
      sessionId: 'r',
    });
  });

  it('active immutable agent maps to an agent place', () => {
    expect(
      deriveChatPlace(
        snap({
          mode: { status: 'active', isMutable: false, isCreateAgent: false, agentName: 'helper', locked: false },
        }),
      ),
    ).toEqual({ type: 'agent', agentName: 'helper' });
  });

  it('SingleAgent canonicalizes the immutable agent to root', () => {
    expect(
      deriveChatPlace(
        snap({
          agentConfigMode: 'SingleAgent',
          mode: { status: 'active', isMutable: false, isCreateAgent: false, agentName: 'locked', locked: true },
        }),
      ),
    ).toEqual({ type: 'root' });
  });

  it('mutable draft and idle map to root', () => {
    expect(deriveChatPlace(snap({ mode: { status: 'idle' } }))).toEqual({ type: 'root' });
    expect(
      deriveChatPlace(snap({ mode: { status: 'active', isMutable: true, isCreateAgent: false, locked: false } })),
    ).toEqual({
      type: 'root',
    });
  });
});
