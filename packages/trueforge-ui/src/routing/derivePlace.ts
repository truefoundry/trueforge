import type { RoutePlace, ShellSnapshot } from './types.js';

/**
 * The chat place implied by shell state, ignoring the settings overlay.
 * SingleAgent canonicalizes to `root` so `/` and `/agents/{name}` alias.
 */
export function deriveChatPlace(snapshot: ShellSnapshot): RoutePlace {
  // The live thread wins: reusing a mutable shell switches thread without a
  // remount, leaving `pendingSessionId` on the session the shell last opened.
  // It only leads while a requested session has not reported its thread yet.
  const sessionId = snapshot.activeRemoteId ?? snapshot.pendingSessionId;
  if (sessionId != null) return { type: 'session', sessionId };

  const { mode, agentConfigMode } = snapshot;
  if (mode.status === 'active' && !mode.isMutable && agentConfigMode !== 'SingleAgent') {
    const agentName = mode.agentName ?? mode.agentId;
    if (agentName != null) return { type: 'agent', agentName };
  }
  return { type: 'root' };
}

/** Full place including the settings overlay, which wins over the chat place. */
export function derivePlace(snapshot: ShellSnapshot): RoutePlace {
  if (snapshot.settingsOpen) return { type: 'settings' };
  return deriveChatPlace(snapshot);
}
