import type { SessionEventItem } from './server/events.js';
import type { Session } from './server/types.js';
import type { SessionSnapshot } from './sessionSnapshot.js';

export interface CachedSessionEntry {
  session: Session;
  events: SessionEventItem[];
  snapshot?: SessionSnapshot;
  /** True only after history drains every events page. Chat writes stay incomplete. */
  complete: boolean;
  fetchedAt: number;
}

const MAX_CACHED_SESSIONS = 50;

export interface SessionEventsCache {
  get(sessionId: string): CachedSessionEntry | undefined;
  set(sessionId: string, entry: CachedSessionEntry): void;
  /** Stores the live chat snapshot without replacing a complete event list. */
  updateSnapshot(sessionId: string, snapshot: SessionSnapshot): void;
  updateMetadata(sessionId: string, update: Partial<Session>): void;
  invalidate(sessionId: string): void;
  clear(): void;
}

/** Per-shell LRU cache for session timelines shared by chat and history. */
export function createSessionEventsCache(): SessionEventsCache {
  const sessionCache = new Map<string, CachedSessionEntry>();

  function set(sessionId: string, entry: CachedSessionEntry): void {
    if (sessionCache.has(sessionId)) {
      sessionCache.delete(sessionId);
    } else if (sessionCache.size >= MAX_CACHED_SESSIONS) {
      const oldestKey = sessionCache.keys().next().value;
      if (oldestKey != null) {
        sessionCache.delete(oldestKey);
      }
    }
    sessionCache.set(sessionId, entry);
  }

  return {
    get(sessionId) {
      const entry = sessionCache.get(sessionId);
      if (entry == null) {
        return undefined;
      }
      // LRU touch: re-insert at end
      sessionCache.delete(sessionId);
      sessionCache.set(sessionId, entry);
      return entry;
    },

    set,

    updateSnapshot(sessionId, snapshot) {
      const existing = sessionCache.get(sessionId);
      if (existing != null) {
        existing.snapshot = snapshot;
        return;
      }
      if (snapshot.turns.length === 0 && (snapshot.historyEvents == null || snapshot.historyEvents.length === 0)) {
        return;
      }
      // Placeholder session until history or loadSessionSnapshot fills metadata.
      set(sessionId, {
        session: {
          id: sessionId,
          title: '',
          isMutable: true,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        events: [],
        snapshot,
        complete: false,
        fetchedAt: Date.now(),
      });
    },

    updateMetadata(sessionId, update) {
      const existing = sessionCache.get(sessionId);
      if (existing != null) {
        existing.session = { ...existing.session, ...update };
      }
    },

    invalidate(sessionId) {
      sessionCache.delete(sessionId);
    },

    clear() {
      sessionCache.clear();
    },
  };
}
