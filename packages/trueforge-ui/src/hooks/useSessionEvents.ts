import { useEffect, useRef, useState } from 'react';
import { useOptionalSessionEventsCache } from '../server/SessionEventsCacheContext.js';
import type { AgentChatServer, AgentSessionsServer, Session, SessionEventItem } from '../server/types.js';
import { drainListPages } from '../utils/drainListPages.js';

export type UseSessionEventsOptions = {
  sessionId: string | null | undefined;
  sessionsServer: Pick<AgentSessionsServer, 'listSessionEvents'>;
  chatServer: Pick<AgentChatServer, 'getSession'>;
  refreshKey?: number;
  onError?: (error: unknown) => void;
};

export type UseSessionEventsResult = {
  events: SessionEventItem[] | undefined;
  session: Session | undefined;
  loading: boolean;
  failed: boolean;
  isRevalidating: boolean;
};

function hasPaintableCache(entry: { events: SessionEventItem[]; complete: boolean } | undefined): boolean {
  return entry != null && (entry.events.length > 0 || entry.complete);
}

/**
 * Loads session events and metadata with paint-then-refresh caching.
 * Cached data paints immediately; listSessionEvents always runs in the background.
 */
export function useSessionEvents({
  sessionId,
  sessionsServer,
  chatServer,
  refreshKey = 0,
  onError,
}: UseSessionEventsOptions): UseSessionEventsResult {
  const sessionEventsCache = useOptionalSessionEventsCache();
  const cachedInitial = sessionId != null && sessionId.length > 0 ? sessionEventsCache?.get(sessionId) : undefined;
  const paintInitial = hasPaintableCache(cachedInitial);

  const [events, setEvents] = useState<SessionEventItem[] | undefined>(() =>
    paintInitial ? cachedInitial?.events : undefined,
  );
  const [session, setSession] = useState<Session | undefined>(() =>
    paintInitial ? cachedInitial?.session : undefined,
  );
  const [loading, setLoading] = useState(() => !paintInitial && sessionId != null && sessionId.length > 0);
  const [failed, setFailed] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (sessionId == null || sessionId.length === 0) {
      setEvents(undefined);
      setSession(undefined);
      setFailed(false);
      setLoading(false);
      setIsRevalidating(false);
      return;
    }

    let cancelled = false;
    const cached = sessionEventsCache?.get(sessionId);
    const paintCached = hasPaintableCache(cached);

    if (paintCached && cached != null) {
      setEvents(cached.events);
      setSession(cached.session);
      setFailed(false);
      setLoading(false);
      setIsRevalidating(true);
    } else {
      setEvents(undefined);
      setSession(undefined);
      setLoading(true);
      setFailed(false);
      setIsRevalidating(false);
    }

    void Promise.all([
      drainListPages({
        fetchPage: pageToken =>
          sessionsServer.listSessionEvents({
            sessionId,
            limit: 100,
            ...(pageToken == null ? {} : { pageToken }),
          }),
      }),
      chatServer.getSession({ sessionId }),
    ])
      .then(([itemsNewestFirst, loadedSession]) => {
        if (cancelled) return;
        const chronologicalEvents = [...itemsNewestFirst].reverse();
        sessionEventsCache?.set(sessionId, {
          session: loadedSession,
          events: chronologicalEvents,
          snapshot: cached?.snapshot,
          complete: true,
          fetchedAt: Date.now(),
        });
        setEvents(chronologicalEvents);
        setSession(loadedSession);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onErrorRef.current?.(error);
        if (!paintCached) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setIsRevalidating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chatServer, refreshKey, sessionEventsCache, sessionId, sessionsServer]);

  return { events, session, loading, failed, isRevalidating };
}
