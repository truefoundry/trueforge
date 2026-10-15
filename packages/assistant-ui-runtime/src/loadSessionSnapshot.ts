import type { AgentChatServer } from './server/types.js';

import { buildSnapshotFromSessionEvents } from './convertTurnMessages.js';
import type { SessionEventsCache } from './sessionEventsCache.js';
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
  options?: {
    onProgress?: (snap: SessionSnapshot) => void;
    sessionEventsCache?: SessionEventsCache;
  },
): Promise<SessionSnapshot> {
  const onProgress = options?.onProgress;
  const sessionEventsCache = options?.sessionEventsCache;
  let inflight = inflightBySessionId.get(sessionId);
  if (inflight == null) {
    inflight = Promise.all([
      getSession(server, sessionId),
      buildSnapshotFromSessionEvents(server, sessionId, onProgress),
    ])
      .then(([session, snapshot]) => {
        if (sessionEventsCache != null) {
          const existing = sessionEventsCache.get(sessionId);
          if (existing?.complete === true) {
            // Keep the drained history events; only refresh session + chat snapshot.
            sessionEventsCache.updateMetadata(sessionId, session);
            sessionEventsCache.updateSnapshot(sessionId, snapshot);
          } else {
            sessionEventsCache.set(sessionId, {
              session,
              events: snapshot.historyEvents != null ? [...snapshot.historyEvents] : [],
              snapshot,
              complete: false,
              fetchedAt: Date.now(),
            });
          }
        }
        return snapshot;
      })
      .finally(() => {
        if (inflightBySessionId.get(sessionId) === inflight) {
          inflightBySessionId.delete(sessionId);
        }
      });
    inflightBySessionId.set(sessionId, inflight);
  }
  return inflight;
}
