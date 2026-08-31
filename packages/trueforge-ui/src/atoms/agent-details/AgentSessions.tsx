'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAgentSessionsServer } from '../../server/ServerContext.js';
import type { SessionEventItem, SessionListEntry } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentSessionsProps } from './types.js';

const SESSION_ID_QUERY = 'sessionId';

function sessionTitle(entry: Pick<SessionListEntry, 'title'>): string {
  const title = entry.title?.trim();
  return title != null && title.length > 0 ? title : 'Untitled session';
}

function dateToStartTimestamp(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function dateToEndTimestamp(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

export function AgentSessions({ agentId }: AgentSessionsProps) {
  const sessionsServer = useAgentSessionsServer();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSessionId = searchParams.get(SESSION_ID_QUERY);

  const AgentSessionListRow = useSlot('AgentSessionListRow');
  const AgentSessionDetailHeader = useSlot('AgentSessionDetailHeader');
  const AgentSessionTimelineContainer = useSlot('AgentSessionTimelineContainer');

  const [entries, setEntries] = useState<SessionListEntry[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [detailEvents, setDetailEvents] = useState<SessionEventItem[]>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);

  const listRequest = useMemo(
    () => ({
      agentId,
      order: 'desc' as const,
      limit: 20,
      ...(startDate.length > 0 ? { startTimestamp: dateToStartTimestamp(startDate) } : {}),
      ...(endDate.length > 0 ? { endTimestamp: dateToEndTimestamp(endDate) } : {}),
    }),
    [agentId, endDate, startDate],
  );

  const loadInitialList = useCallback(async () => {
    setListLoading(true);
    setListFailed(false);
    try {
      const page = await sessionsServer.listSessions(listRequest);
      setEntries(page.data);
      setNextPageToken(page.nextPageToken);
    } catch {
      setEntries([]);
      setNextPageToken(undefined);
      setListFailed(true);
    } finally {
      setListLoading(false);
    }
  }, [listRequest, sessionsServer]);

  useEffect(() => {
    void loadInitialList();
  }, [loadInitialList]);

  const loadMore = useCallback(async () => {
    if (nextPageToken == null || listLoadingMore) return;
    setListLoadingMore(true);
    try {
      const page = await sessionsServer.listSessions({ ...listRequest, pageToken: nextPageToken });
      setEntries(current => [...current, ...page.data]);
      setNextPageToken(page.nextPageToken);
    } catch {
      setListFailed(true);
    } finally {
      setListLoadingMore(false);
    }
  }, [listLoadingMore, listRequest, nextPageToken, sessionsServer]);

  useEffect(() => {
    if (selectedSessionId == null || selectedSessionId.length === 0) {
      setDetailEvents(undefined);
      setDetailFailed(false);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailFailed(false);
    setDetailEvents(undefined);

    void drainListPages({
      fetchPage: pageToken =>
        sessionsServer.listSessionEvents({
          sessionId: selectedSessionId,
          limit: 100,
          ...(pageToken == null ? {} : { pageToken }),
        }),
    })
      .then(itemsNewestFirst => {
        if (cancelled) return;
        setDetailEvents([...itemsNewestFirst].reverse());
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
  }, [selectedSessionId, sessionsServer]);

  const selectSession = (sessionId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(SESSION_ID_QUERY, sessionId);
    setSearchParams(next, { replace: true });
  };

  const clearSelectedSession = () => {
    if (!searchParams.has(SESSION_ID_QUERY)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(SESSION_ID_QUERY);
    setSearchParams(next, { replace: true });
  };

  const selectedEntry = entries.find(entry => entry.id === selectedSessionId);
  const selectedTitle = selectedEntry != null ? sessionTitle(selectedEntry) : (selectedSessionId ?? 'Untitled session');

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border bg-primary-bg md:max-w-sm">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Sessions</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
              From
              <input
                type="date"
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
                className="h-8 rounded-md border border-border bg-primary-bg px-2 text-xs text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
              To
              <input
                type="date"
                value={endDate}
                onChange={event => setEndDate(event.target.value)}
                className="h-8 rounded-md border border-border bg-primary-bg px-2 text-xs text-text-primary"
              />
            </label>
          </div>
        </div>

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
                onSelect={() => selectSession(entry.id)}
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
              onClose={clearSelectedSession}
            />
            {detailLoading || detailEvents === undefined ? (
              <div className="flex flex-1 flex-col p-4" role="status" aria-label="Loading session details">
                <Skeleton className="min-h-64 flex-1 rounded-lg" />
              </div>
            ) : (
              <AgentSessionTimelineContainer sessionId={selectedSessionId} events={detailEvents} />
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
