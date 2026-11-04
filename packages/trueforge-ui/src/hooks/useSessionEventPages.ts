'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAgentSessionsServer } from '../server/ServerContext.js';
import type { SessionEventItem } from '../server/types.js';

const SESSION_EVENTS_PAGE_SIZE = 100;

export type SessionEventPagesState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      /** Chronological events loaded so far; older pages are prepended as they arrive. */
      itemsAsc: SessionEventItem[];
      loadingOlder: boolean;
      olderFailed: boolean;
    };

/**
 * Loads session events newest page first and exposes each page as soon as it lands,
 * then keeps draining older pages in the background until history is exhausted.
 */
export function useSessionEventPages({ sessionId, refreshKey }: { sessionId: string | null; refreshKey: number }): {
  state: SessionEventPagesState;
  retryOlder: () => void;
} {
  const sessionsServer = useAgentSessionsServer();
  const [state, setState] = useState<SessionEventPagesState>({ status: 'idle' });
  const requestIdRef = useRef(0);
  // Where to resume after an older page fails.
  const failedPageRef = useRef<{ requestId: number; sessionId: string; pageToken: string } | null>(null);

  const drain = useCallback(
    async ({ requestId, sessionId, pageToken }: { requestId: number; sessionId: string; pageToken?: string }) => {
      let token = pageToken;
      do {
        let page;
        try {
          page = await sessionsServer.listSessionEvents({
            sessionId,
            limit: SESSION_EVENTS_PAGE_SIZE,
            ...(token == null ? {} : { pageToken: token }),
          });
        } catch (error) {
          if (requestIdRef.current !== requestId) return;
          if (token == null) {
            setState({ status: 'error', error });
            return;
          }
          failedPageRef.current = { requestId, sessionId, pageToken: token };
          setState(current =>
            current.status === 'ready' ? { ...current, loadingOlder: false, olderFailed: true } : current,
          );
          return;
        }
        if (requestIdRef.current !== requestId) return;
        token = page.nextPageToken != null && page.nextPageToken.length > 0 ? page.nextPageToken : undefined;
        const olderAsc = [...page.data].reverse();
        const loadingOlder = token != null;
        setState(current => ({
          status: 'ready',
          itemsAsc: current.status === 'ready' ? [...olderAsc, ...current.itemsAsc] : olderAsc,
          loadingOlder,
          olderFailed: false,
        }));
      } while (token != null);
    },
    [sessionsServer],
  );

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    failedPageRef.current = null;
    if (sessionId == null || sessionId.length === 0) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    void drain({ requestId, sessionId });
    return () => {
      // Bumping the id makes in-flight pages for the previous session no-ops.
      requestIdRef.current += 1;
    };
  }, [drain, refreshKey, sessionId]);

  const retryOlder = useCallback(() => {
    const failed = failedPageRef.current;
    if (failed == null || failed.requestId !== requestIdRef.current) return;
    failedPageRef.current = null;
    setState(current =>
      current.status === 'ready' ? { ...current, loadingOlder: true, olderFailed: false } : current,
    );
    void drain(failed);
  }, [drain]);

  return { state, retryOlder };
}
