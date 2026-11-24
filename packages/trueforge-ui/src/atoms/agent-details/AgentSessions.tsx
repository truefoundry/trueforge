'use client';

import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { withSessionProps } from '../../analytics/sessionProps.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useResourcePermissions } from '../../hooks/useResourcePermissions.js';
import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { Icon } from '../../icons/Icon.js';
import { buildSessionResumeHref } from '../../routing/paths.js';
import { useOptionalResolvedRoutes } from '../../routing/ResolvedRoutesContext.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useAgentSessionsServer, useOptionalScheduleServer, useServer } from '../../server/ServerContext.js';
import {
  invalidateOutdatedSessionDetails,
  isLastTurnRunning,
  removeSessionQueries,
  sessionDetailQuery,
} from '../../server/sessionQueries.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { ListResult, SessionListEntry } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { writeOpenScheduleByIdSearch } from '../../utils/scheduleShareUrl.js';
import { sessionTimeRangeFromCreatedAt } from '../../utils/sessionShareUrl.js';
import { EmptyScreen } from '../EmptyScreen.js';
import { cn } from '../lib/cn.js';
import { sessionIsCreateAgent } from '../lib/sessionCreateAgent.js';
import { SESSION_LIST_FIRST_PAGE_LIMIT, sessionListPollIntervalMs } from '../lib/sessionListPoll.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentSessionsProps } from './types.js';

const LOAD_MORE_ROOT_MARGIN = '96px';

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

function entryScheduleId(entry: SessionListEntry): string | undefined {
  const scheduleId: unknown = 'scheduleId' in entry ? Reflect.get(entry, 'scheduleId') : undefined;
  return typeof scheduleId === 'string' && scheduleId.length > 0 ? scheduleId : undefined;
}

export function AgentSessions({
  agentId,
  startTimestamp,
  endTimestamp,
  createdByMe = false,
  shareView,
  detailOnly = false,
  detailSessionId,
  onCloseDetail,
  onLoadRecentSessions,
  refreshKey = 0,
  onLoadingChange,
}: AgentSessionsProps) {
  const sessionsServer = useAgentSessionsServer();
  const chatServer = useServer();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const shell = useOptionalShellMode();
  const scheduleServer = useOptionalScheduleServer();
  const routes = useOptionalResolvedRoutes();
  const { sessionId: querySessionId, updateShareSearch } = useSessionShareSearch();
  const selectedSessionId = detailOnly ? (detailSessionId ?? null) : querySessionId;

  const AgentSessionListRow = useSlot('AgentSessionListRow');
  const AgentSessionDetailHeader = useSlot('AgentSessionDetailHeader');
  const AgentSessionTimelineContainer = useSlot('AgentSessionTimelineContainer');

  const queryClient = useServerQueryClient();
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionListEntry | null>(null);

  const listRequest = useMemo(
    () => ({
      order: 'desc' as const,
      limit: SESSION_LIST_FIRST_PAGE_LIMIT,
      ...(agentId == null || agentId.length === 0 ? {} : { agentId }),
      ...(startTimestamp == null ? {} : { startTimestamp }),
      ...(endTimestamp == null ? {} : { endTimestamp }),
      ...(createdByMe ? { createdByMe: true } : {}),
    }),
    [agentId, createdByMe, endTimestamp, startTimestamp],
  );
  const listKey = queryKeys.sessions.pages(listRequest);

  const listQuery = useInfiniteQuery(
    {
      queryKey: listKey,
      queryFn: async ({ pageParam }) => {
        const page = await sessionsServer.listSessions({
          ...listRequest,
          ...(pageParam === '' ? {} : { pageToken: pageParam }),
        });
        invalidateOutdatedSessionDetails({ queryClient, sessions: page.data });
        return page;
      },
      // Empty token means the first page.
      initialPageParam: '',
      getNextPageParam: lastPage =>
        lastPage.nextPageToken == null || lastPage.nextPageToken === '' ? undefined : lastPage.nextPageToken,
      enabled: !detailOnly,
      // ponytail: a poll refetches every loaded page (pages × one request per 30s while a row is live);
      // upgrade to patching only the first page via setQueryData if long lists make that costly.
      refetchInterval: query =>
        sessionListPollIntervalMs(
          (query.state.data?.pages ?? []).flatMap(page => page.data.map(entry => entry.lastTurnDetails?.state.status)),
        ) ?? false,
    },
    queryClient,
  );
  const entries = useMemo(() => listQuery.data?.pages.flatMap(page => page.data) ?? [], [listQuery.data]);
  const listLoading = !detailOnly && listQuery.isPending;
  // A failed poll keeps the last rows on screen; only a list that never loaded shows the error.
  const listFailed = listQuery.isError && listQuery.data == null;
  const hasNextPage = listQuery.hasNextPage;
  const listLoadingMore = listQuery.isFetchingNextPage;
  const listLoadMoreFailed = listQuery.isFetchNextPageError;

  const hasSelection = selectedSessionId != null && selectedSessionId.length > 0;
  const detailQuery = useQuery(
    {
      ...sessionDetailQuery({ server: chatServer, sessionId: selectedSessionId ?? '' }),
      enabled: hasSelection,
    },
    queryClient,
  );
  const detailSession = hasSelection ? detailQuery.data : undefined;
  const eventsQuery = useQuery(
    {
      queryKey: queryKeys.sessions.events({
        sessionId: selectedSessionId ?? '',
        version: detailSession?.updatedAt ?? '',
      }),
      queryFn: async () => {
        const itemsNewestFirst = await drainListPages({
          fetchPage: pageToken =>
            sessionsServer.listSessionEvents({
              sessionId: selectedSessionId ?? '',
              ...(pageToken == null ? {} : { pageToken }),
            }),
        });
        return [...itemsNewestFirst].reverse();
      },
      enabled: detailSession != null,
      // A running turn appends events without bumping `updatedAt`, so that timeline must not be reused.
      staleTime: isLastTurnRunning(detailSession) ? 0 : Infinity,
    },
    queryClient,
  );
  const detailEvents = detailSession == null ? undefined : eventsQuery.data;
  const detailError = hasSelection ? (detailQuery.error ?? eventsQuery.error) : null;
  const detailFailed = detailError != null;
  const detailErrorMessage = getErrorMessage(detailError, 'This session could not be loaded.');

  const canDeleteSession = typeof chatServer.deleteSession === 'function';
  const permissionResourceIds = useMemo(() => {
    const ids = new Set(entries.map(entry => entry.id));
    if (selectedSessionId != null && selectedSessionId.length > 0) ids.add(selectedSessionId);
    return [...ids];
  }, [entries, selectedSessionId]);
  const { allows } = useResourcePermissions({
    resourceType: 'session',
    resourceIds: permissionResourceIds,
  });
  const canResume = allows(selectedSessionId, 'MANAGE');

  const { fetchNextPage } = listQuery;
  const loadMore = useCallback(() => {
    // The observer can fire twice before a re-render; `cancelRefetch: false` joins the in-flight page.
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);

  // `entries.length` re-arms the observer: an already-intersecting sentinel emits no new entry.
  useEffect(() => {
    if (listLoading || !hasNextPage || listEl == null || sentinelEl == null) return;

    const observer = new IntersectionObserver(
      observed => {
        if (observed.some(entry => entry.isIntersecting)) loadMore();
      },
      { root: listEl, rootMargin: LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [entries.length, hasNextPage, listEl, listLoading, loadMore, sentinelEl]);

  // Reload from the page header refetches the list and the open session, including its timeline.
  const refreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKeyRef.current === refreshKey) return;
    refreshKeyRef.current = refreshKey;
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
  }, [queryClient, refreshKey]);

  const loading = listQuery.isFetching || (hasSelection && (detailQuery.isFetching || eventsQuery.isFetching));
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const selectSession = (entry: SessionListEntry) => {
    const pinned = shareView === 'sessions' ? sessionTimeRangeFromCreatedAt(entry.createdAt) : null;
    updateShareSearch({
      sessionId: entry.id,
      ...(shareView === 'sessions'
        ? { view: 'sessions', ...(pinned == null ? {} : { timeRange: pinned }) }
        : { agentId: agentId ?? null, tab: 'sessions', view: null, timeRange: null }),
    });
  };

  // One lookup per schedule, shared by every session row from that schedule.
  const scheduleNamesRef = useRef(new Map<string, Promise<string | null>>());
  const loadScheduleName = (scheduleId: string): Promise<string | null> => {
    if (scheduleServer == null) return Promise.resolve(null);
    let name = scheduleNamesRef.current.get(scheduleId);
    if (name == null) {
      name = scheduleServer.getSchedule({ id: scheduleId }).then(
        schedule => schedule.name,
        () => {
          scheduleNamesRef.current.delete(scheduleId);
          return null;
        },
      );
      scheduleNamesRef.current.set(scheduleId, name);
    }
    return name;
  };

  const openSchedule = ({ id, name }: { id: string; name: string }) => {
    track(AnalyticsEvents.Schedule.OPENED_FROM_SESSION, { schedule_id: id });
    writeOpenScheduleByIdSearch({ id, name });
    shell?.setSchedulesOpen(true);
  };

  const clearSelectedSession = () => {
    if (selectedSessionId == null) return;
    if (detailOnly) {
      onCloseDetail?.();
      return;
    }
    updateShareSearch({ sessionId: null });
  };

  const handleDelete = async (entry: SessionListEntry) => {
    if (!allows(entry.id, 'DELETE') || typeof chatServer.deleteSession !== 'function') return;
    setPendingDelete(null);
    try {
      await chatServer.deleteSession({ sessionId: entry.id });
      track(
        AnalyticsEvents.Session.DELETED,
        withSessionProps(undefined, { sessionId: entry.id, agentName: entry.agentName }),
      );
      // Drop the row now; the list invalidation below refetches it without the deleted session.
      queryClient.setQueryData<InfiniteData<ListResult<SessionListEntry>, string>>(listKey, data =>
        data == null
          ? data
          : {
              ...data,
              pages: data.pages.map(page => ({ ...page, data: page.data.filter(item => item.id !== entry.id) })),
            },
      );
      void removeSessionQueries({ queryClient, sessionId: entry.id });
      if (selectedSessionId === entry.id) {
        updateShareSearch({ sessionId: null });
      }
    } catch (caught) {
      toaster?.showError(caught);
    }
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
  const resumeHref =
    selectedSessionId != null && routes != null
      ? buildSessionResumeHref({ sessionId: selectedSessionId, routes })
      : null;

  const handleResume = () => {
    if (!canResume || selectedSessionId == null || shell == null) return;
    const agentName = detailSession?.agentName ?? selectedEntry?.agentName;
    shell.openHistorySession({
      sessionId: selectedSessionId,
      isMutable: resumeIsMutable,
      isCreateAgent: resumeIsCreateAgent,
      ...(agentName != null && agentName.length > 0 ? { agentName } : {}),
    });
  };

  const resumeProps =
    resumeHref != null ? { resumeHref, resumeLabel } : shell != null ? { onResume: handleResume, resumeLabel } : {};

  const detailPanel = (
    <section className="isolate flex h-full min-w-0 flex-col bg-primary-bg">
      {selectedSessionId == null ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
          Select a session to view details
        </div>
      ) : detailFailed ? (
        <EmptyScreen title="Unable to load session" description={detailErrorMessage} className="bg-primary-bg" />
      ) : (
        <>
          <AgentSessionDetailHeader
            title={selectedTitle}
            sessionId={selectedSessionId}
            metadata={detailSession?.metadata ?? selectedEntry?.metadata}
            onClose={clearSelectedSession}
            canResume={canResume}
            canShare={canResume}
            {...resumeProps}
          />
          {detailEvents === undefined ? (
            <div className="flex flex-1 flex-col p-4" role="status" aria-label="Loading session details">
              <Skeleton className="min-h-64 flex-1 rounded-lg" />
            </div>
          ) : (
            <AgentSessionTimelineContainer
              sessionId={selectedSessionId}
              events={detailEvents}
              sessionMetrics={detailSession?.metrics}
              {...(detailOnly ? { contentMaxWidth: '60rem' } : {})}
            />
          )}
        </>
      )}
    </section>
  );

  if (detailOnly) {
    return <div className="h-full min-h-0 w-full">{detailPanel}</div>;
  }

  // Full empty only when nothing is selected — keep the detail pane for deep-linked sessionIds
  // (filters/time range can empty the list while share state still points at a session).
  if (
    !listLoading &&
    !listFailed &&
    entries.length === 0 &&
    (selectedSessionId == null || selectedSessionId.length === 0) &&
    onLoadRecentSessions == null
  ) {
    return (
      <EmptyScreen
        title="No Sessions Found"
        description="There are no sessions available at the moment."
        className="bg-primary-bg"
      />
    );
  }

  return (
    <Group
      id="agent-sessions-split"
      orientation="horizontal"
      className="h-full min-h-0 w-full"
      resizeTargetMinimumSize={{ coarse: 24, fine: 11 }}
    >
      <Panel id="agent-sessions-list" defaultSize="35%" minSize="20%" maxSize="50%">
        <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar-bg">
          {onLoadRecentSessions != null ? (
            <div className="flex shrink-0 justify-center border-b border-border p-3">
              <Button.Secondary type="button" size="small" onClick={onLoadRecentSessions}>
                Load recent sessions
              </Button.Secondary>
            </div>
          ) : null}
          <div ref={setListEl} className="scrollbar-none relative min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="space-y-2 p-3" role="status" aria-label="Loading sessions">
                {['a', 'b', 'c'].map(key => (
                  <Skeleton key={key} className="h-16 rounded-md" />
                ))}
              </div>
            ) : listFailed ? (
              <p className="px-3 py-6 text-center text-xs text-text-secondary">Sessions could not be loaded.</p>
            ) : (
              entries.map(entry => (
                <AgentSessionListRow
                  key={entry.id}
                  title={sessionTitle(entry)}
                  agentName={entry.agentName ?? undefined}
                  scheduleId={entryScheduleId(entry)}
                  lastActivityAt={entry.lastActivityAt}
                  {...(entry.lastTurnDetails == null ? {} : { lastTurnStatus: entry.lastTurnDetails.state.status })}
                  metrics={entry.metrics}
                  {...(entry.createdBySubject == null ? {} : { createdBySubject: entry.createdBySubject })}
                  active={entry.id === selectedSessionId}
                  onSelect={() => selectSession(entry)}
                  {...(shell == null ? {} : { onOpenSchedule: openSchedule })}
                  {...(scheduleServer == null ? {} : { loadScheduleName })}
                  {...(canDeleteSession
                    ? {
                        onRequestDelete: () => setPendingDelete(entry),
                        canDelete: allows(entry.id, 'DELETE'),
                      }
                    : {})}
                />
              ))
            )}

            {hasNextPage && !listLoading && !listFailed ? (
              <div ref={setSentinelEl} className="px-3 py-2">
                {listLoadingMore ? (
                  <Skeleton className="h-16 rounded-md" role="status" aria-label="Loading more sessions" />
                ) : listLoadMoreFailed ? (
                  <button
                    type="button"
                    className="h-8 w-full rounded-md border border-border text-xs font-medium text-text-primary hover:bg-ghost-button-hover"
                    onClick={loadMore}
                  >
                    Retry loading sessions
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      </Panel>

      <Separator
        id="agent-sessions-resizer"
        aria-label="Resize session list"
        className="group/resizer relative z-30 w-0 cursor-col-resize focus-visible:outline-none"
      >
        <div aria-hidden className="absolute inset-y-0 -left-1.25 w-2.75" />
        <div aria-hidden className="absolute inset-y-0 left-0 w-px bg-border transition-colors" />
        <div
          aria-hidden
          className={cn(
            'absolute top-1/2 left-0 z-10 flex h-4 w-2 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs shadow-sm transition-colors',
            'bg-secondary-button-bg text-text-secondary',
            'group-hover/resizer:bg-primary-button-bg group-hover/resizer:text-primary-button-text',
            'group-active/resizer:bg-primary-button-bg group-active/resizer:text-primary-button-text',
            'group-focus-visible/resizer:bg-primary-button-bg group-focus-visible/resizer:text-primary-button-text',
          )}
        >
          <Icon name="grip-vertical" size={10} />
        </div>
      </Separator>

      <Panel id="agent-session-detail" defaultSize="65%" minSize="30%">
        {detailPanel}
      </Panel>

      {pendingDelete != null ? (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setPendingDelete(null);
          }}
          aria-label="Delete session"
          className="max-w-md"
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete session</DialogTitle>
              <p className="text-text-secondary text-sm">
                “{sessionTitle(pendingDelete)}” will be permanently deleted. This cannot be undone.
              </p>
            </DialogHeader>
          </DialogContent>
          <DialogFooter>
            <Button.Secondary type="button" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button.Secondary>
            <Button.Destructive
              type="button"
              disabled={!allows(pendingDelete.id, 'DELETE')}
              onClick={() => void handleDelete(pendingDelete)}
            >
              Delete
            </Button.Destructive>
          </DialogFooter>
        </Dialog>
      ) : null}
    </Group>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessions: ComponentType<AgentSessionsProps>;
  }
}
