'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { useAgentSessionsServer, useServer } from '../../server/ServerContext.js';
import type { Session, SessionEventItem, SessionListEntry } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { sessionTimeRangeFromCreatedAt } from '../../utils/sessionShareUrl.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentSessionsProps } from './types.js';

function sessionTitle(entry: Pick<SessionListEntry, 'title'>): string {
  const title = entry.title?.trim();
  return title != null && title.length > 0 ? title : 'Untitled session';
}

export function AgentSessions({ agentId, startTimestamp, endTimestamp, shareView }: AgentSessionsProps) {
  const sessionsServer = useAgentSessionsServer();
  const chatServer = useServer();
  const { sessionId: selectedSessionId, updateShareSearch } = useSessionShareSearch();

  const AgentSessionListRow = useSlot('AgentSessionListRow');
  const AgentSessionDetailHeader = useSlot('AgentSessionDetailHeader');
  const AgentSessionTimelineContainer = useSlot('AgentSessionTimelineContainer');

  const [entries, setEntries] = useState<SessionListEntry[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const listRequestIdRef = useRef(0);
  const [detailEvents, setDetailEvents] = useState<SessionEventItem[]>();
  const [detailSession, setDetailSession] = useState<Session>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);

  const listRequest = useMemo(
    () => ({
      order: 'desc' as const,
      limit: 20,
      ...(agentId == null || agentId.length === 0 ? {} : { agentId }),
      ...(startTimestamp == null ? {} : { startTimestamp }),
      ...(endTimestamp == null ? {} : { endTimestamp }),
    }),
    [agentId, endTimestamp, startTimestamp],
  );

  useEffect(() => {
    const requestId = ++listRequestIdRef.current;
    let cancelled = false;
    setListLoading(true);
    setListLoadingMore(false);
    setListFailed(false);
    void sessionsServer
      .listSessions(listRequest)
      .then(page => {
        if (cancelled || listRequestIdRef.current !== requestId) return;
        setEntries(page.data);
        setNextPageToken(page.nextPageToken);
      })
      .catch(() => {
        if (cancelled || listRequestIdRef.current !== requestId) return;
        setEntries([]);
        setNextPageToken(undefined);
        setListFailed(true);
      })
      .finally(() => {
        if (!cancelled && listRequestIdRef.current === requestId) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listRequest, sessionsServer]);

  const loadMore = useCallback(async () => {
    if (nextPageToken == null || listLoadingMore) return;
    const requestId = listRequestIdRef.current;
    setListLoadingMore(true);
    try {
      const page = await sessionsServer.listSessions({ ...listRequest, pageToken: nextPageToken });
      if (listRequestIdRef.current !== requestId) return;
      setEntries(current => [...current, ...page.data]);
      setNextPageToken(page.nextPageToken);
    } catch {
      // Keep the current page and token visible so the user can retry.
    } finally {
      if (listRequestIdRef.current === requestId) setListLoadingMore(false);
    }
  }, [listLoadingMore, listRequest, nextPageToken, sessionsServer]);

  useEffect(() => {
    if (selectedSessionId == null || selectedSessionId.length === 0) {
      setDetailEvents(undefined);
      setDetailSession(undefined);
      setDetailFailed(false);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailFailed(false);
    setDetailEvents(undefined);
    setDetailSession(undefined);

    void Promise.all([
      drainListPages({
        fetchPage: pageToken =>
          sessionsServer.listSessionEvents({
            sessionId: selectedSessionId,
            limit: 100,
            ...(pageToken == null ? {} : { pageToken }),
          }),
      }),
      chatServer.getSession({ sessionId: selectedSessionId }).catch(() => undefined),
    ])
      .then(([itemsNewestFirst, session]) => {
        if (cancelled) return;
        setDetailEvents([...itemsNewestFirst].reverse());
        setDetailSession(session);
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatServer, selectedSessionId, sessionsServer]);

  const selectSession = (entry: SessionListEntry) => {
    const pinned = shareView === 'sessions' ? sessionTimeRangeFromCreatedAt(entry.createdAt) : null;
    updateShareSearch({
      sessionId: entry.id,
      ...(shareView === 'sessions'
        ? { view: 'sessions', ...(pinned == null ? {} : { timeRange: pinned }) }
        : { agentId: agentId ?? null, tab: 'sessions', view: null, timeRange: null }),
    });
  };

  const clearSelectedSession = () => {
    if (selectedSessionId == null) return;
    updateShareSearch({ sessionId: null });
  };

  const selectedEntry = entries.find(entry => entry.id === selectedSessionId);
  const selectedTitle =
    detailSession != null
      ? sessionTitle(detailSession)
      : selectedEntry != null
        ? sessionTitle(selectedEntry)
        : (selectedSessionId ?? 'Untitled session');

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border bg-primary-bg md:max-w-sm">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="space-y-2 p-3" role="status" aria-label="Loading sessions">
              {['a', 'b', 'c'].map(key => (
                <Skeleton key={key} className="h-16 rounded-md" />
              ))}
            </div>
          ) : listFailed ? (
            <p className="px-3 py-6 text-center text-xs text-text-secondary">Sessions could not be loaded.</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-secondary">No sessions are there yet</p>
          ) : (
            entries.map(entry => (
              <AgentSessionListRow
                key={entry.id}
                title={sessionTitle(entry)}
                agentName={entry.agentName ?? undefined}
                lastActivityAt={entry.lastActivityAt}
                metrics={entry.metrics}
                active={entry.id === selectedSessionId}
                onSelect={() => selectSession(entry)}
              />
            ))
          )}
        </div>

        {nextPageToken != null && !listLoading ? (
          <div className="shrink-0 border-t border-border p-3">
            <button
              type="button"
              disabled={listLoadingMore}
              onClick={() => void loadMore()}
              className="h-8 w-full rounded-md border border-border text-xs font-medium text-text-primary hover:bg-ghost-button-hover disabled:opacity-60"
            >
              {listLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-primary-bg">
        {selectedSessionId == null ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
            Select a session to view details
          </div>
        ) : detailFailed ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
            Session details could not be loaded.
          </div>
        ) : (
          <>
            <AgentSessionDetailHeader
              title={selectedTitle}
              sessionId={selectedSessionId}
              agentId={agentId}
              createdAt={detailSession?.createdAt ?? selectedEntry?.createdAt}
              view={shareView}
              onClose={clearSelectedSession}
            />
            {detailLoading || detailEvents === undefined ? (
              <div className="flex flex-1 flex-col p-4" role="status" aria-label="Loading session details">
                <Skeleton className="min-h-64 flex-1 rounded-lg" />
              </div>
            ) : (
              <AgentSessionTimelineContainer
                sessionId={selectedSessionId}
                events={detailEvents}
                listMetrics={selectedEntry?.metrics}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessions: ComponentType<AgentSessionsProps>;
  }
}
