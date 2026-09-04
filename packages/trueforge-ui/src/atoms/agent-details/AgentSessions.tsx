'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { Icon } from '../../icons/Icon.js';
import { useAgentSessionsServer, useServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { Session, SessionEventItem, SessionListEntry } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { sessionTimeRangeFromCreatedAt } from '../../utils/sessionShareUrl.js';
import { sessionIsCreateAgent } from '../lib/sessionCreateAgent.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentSessionsProps } from './types.js';

function sessionTitle(entry: Pick<SessionListEntry, 'title'>): string {
  const title = entry.title?.trim();
  return title != null && title.length > 0 ? title : 'Untitled session';
}

function entryIsMutable(entry: SessionListEntry): boolean {
  if ('isMutable' in entry && typeof Reflect.get(entry, 'isMutable') === 'boolean') {
    return Reflect.get(entry, 'isMutable') === true;
  }
  return entry.agentName == null;
}

export function AgentSessions({ agentId, startTimestamp, endTimestamp, shareView }: AgentSessionsProps) {
  const sessionsServer = useAgentSessionsServer();
  const chatServer = useServer();
  const shell = useOptionalShellMode();
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

  const resumeIsCreateAgent =
    detailSession != null
      ? sessionIsCreateAgent(detailSession)
      : selectedEntry != null
        ? sessionIsCreateAgent(selectedEntry)
        : false;
  const resumeIsMutable =
    detailSession != null ? detailSession.isMutable : selectedEntry != null ? entryIsMutable(selectedEntry) : true;
  const resumeLabel = resumeIsCreateAgent ? 'Resume Agent building' : 'Resume Chat';

  const handleResume = () => {
    if (selectedSessionId == null || shell == null) return;
    const agentName = detailSession?.agentName ?? selectedEntry?.agentName;
    shell.openHistorySession({
      sessionId: selectedSessionId,
      isMutable: resumeIsMutable,
      isCreateAgent: resumeIsCreateAgent,
      ...(agentName != null && agentName.length > 0 ? { agentName } : {}),
    });
  };

  return (
    <Group
      id="agent-sessions-split"
      orientation="horizontal"
      className="h-full min-h-0 w-full"
      resizeTargetMinimumSize={{ coarse: 24, fine: 11 }}
    >
      <Panel id="agent-sessions-list" defaultSize="35%" minSize="20%" maxSize="50%">
        <aside className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
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
      </Panel>

      <Separator
        id="agent-sessions-resizer"
        aria-label="Resize session list"
        className="group/resizer relative z-10 w-0 cursor-col-resize focus-visible:outline-none"
      >
        <div aria-hidden className="absolute inset-y-0 -left-1.25 w-2.75" />
        <div aria-hidden className="absolute inset-y-0 left-0 w-px bg-border transition-colors" />
        <div
          aria-hidden
          className="absolute top-1/2 left-0 z-10 flex h-4 w-2 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs bg-primary-button-bg shadow-sm"
        >
          <Icon name="grip-vertical" size={10} className="text-primary-button-text" />
        </div>
      </Separator>

      <Panel id="agent-session-detail" defaultSize="65%" minSize="30%">
        <section className="flex h-full min-w-0 flex-col bg-primary-bg">
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
                {...(shell != null ? { onResume: handleResume, resumeLabel } : {})}
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
      </Panel>
    </Group>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessions: ComponentType<AgentSessionsProps>;
  }
}
