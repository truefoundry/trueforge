import type { AgentChatServer } from './server/types.js';

import { buildSnapshotFromSessionEvents } from './convertTurnMessages.js';
import { getSession } from './sessions.js';
import type { SessionSnapshot } from './sessionSnapshot.js';

const inflightBySessionId = new Map<string, Promise<SessionSnapshot>>();

/**
 * Loads a session snapshot once per concurrent burst for a given session id.
 * React Strict Mode and overlapping fetch/load paths share the same in-flight
 * request instead of duplicating getSession + listEvents calls.
 *
 * `onProgress` is called after each complete turn is ingested so the caller
 * can update the UI progressively while history is being processed.
 */
export function loadSessionSnapshot(
  server: AgentChatServer,
  sessionId: string,
  onProgress?: (snap: SessionSnapshot) => void,
): Promise<SessionSnapshot> {
  let inflight = inflightBySessionId.get(sessionId);
  if (inflight == null) {
    inflight = getSession(server, sessionId)
      .then(() => buildSnapshotFromSessionEvents(server, sessionId, onProgress))
      .finally(() => {
        if (inflightBySessionId.get(sessionId) === inflight) {
          inflightBySessionId.delete(sessionId);
        }
      });
    inflightBySessionId.set(sessionId, inflight);
  }
  return inflight;
}
