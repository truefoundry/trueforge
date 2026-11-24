'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import {
  ThreadListItemByIndexProvider,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import { AgentHistoryFilterButton } from '../atoms/AgentHistoryFilterButton.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { useCompactLayout } from '../atoms/lib/CompactLayoutContext.js';
import { SESSION_LIST_FIRST_PAGE_LIMIT, sessionListPollIntervalMs } from '../atoms/lib/sessionListPoll.js';
import {
  canReuseMutableShell,
  isNewerActivityAt,
  laterActivityAt,
  readThreadAgentName,
  readThreadIsMutable,
  readThreadLastActivityAt,
  readThreadLastTurnStatus,
  threadCustomWithLastTurnStatus,
  threadListIndicesByRecency,
  threadListItemIsMutable,
} from '../atoms/lib/threadListMeta.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { BottomSheet } from '../atoms/primitives/BottomSheet.js';
import ConfirmDeleteDialog from '../atoms/primitives/ConfirmDeleteDialog.js';
import { RenameSessionModal } from '../atoms/RenameSessionModal.js';
import { useResourcePermissions } from '../hooks/useResourcePermissions.js';
import { useSessionListStatusPoll } from '../hooks/useSessionListStatusPoll.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { sessionListStartTimestamp } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useToasterOptional } from './ToasterContainer.js';

/**
 * Simplified relative to the reference: renders threads in a single flat list
 * rather than grouping them by Today/Yesterday/Earlier.
 *
 * Delete asks for confirmation, then calls `aui.threadListItem().delete()`
 * (adapter.delete → server.deleteSession). Rename opens RenameSessionModal via
 * aui.threadListItem().rename (adapter.rename → server.renameSession) when
 * `renameSession` is implemented. Mobile/compact keeps a BottomSheet chrome.
 */
export type ThreadListContainerProps = {
  /** Called after New chat or selecting a row — used by stack/drawer chrome. */
  onThreadOpen?: () => void;
  /**
   * `recent-history` hides navigation and lists only persisted sessions.
   * `mobile-drawer` shows New Chat + Agents Library, then persisted sessions (no Sessions/Schedules).
   */
  variant?: 'default' | 'recent-history' | 'mobile-drawer';
};

const actionItemClass =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-ghost-button-hover focus:bg-ghost-button-hover data-[highlighted]:bg-ghost-button-hover';

const deleteItemClass =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-failure-bg outline-none transition-colors hover:bg-failure-bg/12 hover:text-failure-bg focus:bg-failure-bg/12 focus:text-failure-bg data-[highlighted]:bg-failure-bg/12 data-[highlighted]:text-failure-bg';

function ThreadListItemActionsMenu({
  canRename,
  renameDisabled,
  canDelete,
  deleteDisabled,
  onRename,
  onDelete,
}: {
  canRename: boolean;
  renameDisabled: boolean;
  canDelete: boolean;
  deleteDisabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const PermissionGuard = useSlot('PermissionGuard');
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const useSheet = isMobile || compact;
  const setTriggerElement = useCallback((element: HTMLButtonElement | null) => {
    const themeRoot = element?.closest('.aui-theme-root');
    setPortalContainer(themeRoot instanceof HTMLElement ? themeRoot : undefined);
  }, []);

  const moreButtonClass = auiButtonClass({
    variant: 'ghost',
    size: 'icon',
    // Inherit row color so selected history rows keep matching chrome.
    className: 'size-7 shrink-0 text-inherit hover:bg-transparent hover:text-inherit',
  });

  const renameButton = canRename ? (
    <PermissionGuard allowed={!renameDisabled}>
      <button
        type="button"
        className={actionItemClass}
        disabled={renameDisabled}
        onClick={() => {
          if (renameDisabled) return;
          setSheetOpen(false);
          onRename();
        }}
      >
        <Icon name="pencil" className="size-3.5" />
        Rename
      </button>
    </PermissionGuard>
  ) : null;

  const deleteButton = canDelete ? (
    <PermissionGuard allowed={!deleteDisabled}>
      <button
        type="button"
        className={deleteItemClass}
        disabled={deleteDisabled}
        onClick={() => {
          if (deleteDisabled) return;
          setSheetOpen(false);
          onDelete();
        }}
      >
        <Icon name="trash" className="size-3.5" />
        Delete
      </button>
    </PermissionGuard>
  ) : null;

  if (useSheet) {
    return (
      <>
        <button
          type="button"
          aria-label="Session actions"
          title="Session actions"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={moreButtonClass}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="ellipsis" className="size-3.5" />
        </button>
        {sheetOpen ? (
          <BottomSheet open onOpenChange={setSheetOpen} aria-label="Session actions">
            <div className="flex flex-col gap-1 p-2 *:w-full" role="menu">
              {renameButton}
              {deleteButton}
            </div>
          </BottomSheet>
        ) : null}
      </>
    );
  }

  return (
    <ThreadListItemMorePrimitive.Root sharedFocusGroup>
      <ThreadListItemMorePrimitive.Trigger
        ref={setTriggerElement}
        aria-label="Session actions"
        title="Session actions"
        className={moreButtonClass}
      >
        <Icon name="ellipsis" className="size-3.5" />
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        portalProps={{ container: portalContainer }}
        align="end"
        sideOffset={4}
        className="aui-popup-enter font-sans-flex z-50 min-w-32 rounded-md border border-border bg-card-bg p-1 text-text-primary shadow-md *:w-full"
      >
        {renameButton}
        {deleteButton}
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
}

function ThreadListItemRow({
  selectionRef,
  onThreadOpen,
  canRenameSession,
  canDeleteSession,
  canManageResource,
  canDeleteResource,
}: {
  selectionRef: RefObject<number>;
  onThreadOpen?: () => void;
  canRenameSession: boolean;
  canDeleteSession: boolean;
  canManageResource: (sessionId: string) => boolean;
  canDeleteResource: (sessionId: string) => boolean;
}) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const runtimeKeyRef = useRef(shell?.runtimeKey);
  runtimeKeyRef.current = shell?.runtimeKey;
  const track = useTrackAnalytics();
  const toaster = useToasterOptional();
  const ThreadListRow = useSlot('ThreadListRow');
  const id = useAuiState(s => s.threadListItem.id);
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const lastMessageAt = useAuiState(s => s.threadListItem.lastMessageAt);
  const custom = useAuiState(s => s.threadListItem.custom);
  const mainThreadId = useAuiState(s => s.threads.mainThreadId);
  const agentName = readThreadAgentName(custom);
  const lastTurnStatus = readThreadLastTurnStatus(custom);
  const activityAt = laterActivityAt(lastMessageAt, readThreadLastActivityAt(custom));
  const showRename = canRenameSession && remoteId != null;
  const showDelete = canDeleteSession && remoteId != null;
  const showActions = showRename || showDelete;
  const renameDisabled = remoteId != null && !canManageResource(remoteId);
  const deleteDisabled = remoteId != null && !canDeleteResource(remoteId);
  const sidebarNavOpen =
    shell?.libraryOpen === true ||
    shell?.sessionsOpen === true ||
    shell?.schedulesOpen === true ||
    shell?.environmentsOpen === true;
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const displayTitle = title ?? 'New Chat';

  const persistRename = async (trimmed: string) => {
    if (trimmed === (title ?? '').trim()) {
      setRenameOpen(false);
      return;
    }
    setRenameSaving(true);
    try {
      await aui.threadListItem().rename(trimmed);
      track(AnalyticsEvents.Session.RENAMED, withSessionProps(undefined, { sessionId: remoteId, agentName }));
      setRenameOpen(false);
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setRenameSaving(false);
    }
  };

  const openRow = ({ sessionMutable, rowAgentName }: { sessionMutable: boolean; rowAgentName: string | undefined }) => {
    const sameImmutable =
      !sessionMutable &&
      shell?.mode.status === 'active' &&
      !shell.mode.isMutable &&
      (rowAgentName == null
        ? shell.mode.agentName == null && shell.mode.agentId == null
        : shell.mode.agentName === rowAgentName || shell.mode.agentId === rowAgentName);
    const sameMutable = canReuseMutableShell({
      sessionMutable,
      shellMutable: shell?.mode.status === 'active' && shell.mode.isMutable,
      ...(shell?.mode.status === 'active' && shell.mode.isMutable
        ? { shellAgentName: shell.mode.agentName, shellAgentId: shell.mode.agentId }
        : {}),
      remoteId,
      pendingSessionId: shell?.pendingSessionId,
    });

    // An access-error pane must go through openHistorySession so the error clears.
    if ((sameImmutable || sameMutable) && remoteId != null && shell?.sessionAccessError == null) {
      void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
      return;
    }
    if (remoteId != null) {
      shell?.openHistorySession({
        sessionId: remoteId,
        isMutable: sessionMutable,
        ...(rowAgentName != null ? { agentName: rowAgentName } : {}),
      });
      return;
    }
    void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
  };

  return (
    <ThreadListItemPrimitive.Root className="min-w-0">
      <ThreadListRow
        title={displayTitle}
        active={id === mainThreadId && !sidebarNavOpen}
        agentName={agentName}
        {...(lastTurnStatus == null ? {} : { lastTurnStatus })}
        {...(activityAt == null ? {} : { lastMessageAt: activityAt })}
        onSelect={() => {
          track(
            AnalyticsEvents.Session.SELECTED,
            withSessionProps({ is_mutable: threadListItemIsMutable(custom) }, { sessionId: remoteId, agentName }),
          );
          const selection = ++selectionRef.current;
          const clickedRuntimeKey = shell?.runtimeKey;
          onThreadOpen?.();
          shell?.setSettingsOpen(false);
          shell?.setLibraryOpen(false);
          shell?.setSessionsOpen(false);
          shell?.setSchedulesOpen(false);
          shell?.setEnvironmentsOpen(false);

          // A row created in this client has no custom yet; defaulting to mutable would
          // reopen a saved-agent chat as a draft, so ask the server first.
          if (remoteId != null && server != null && readThreadIsMutable(custom) === undefined && agentName == null) {
            void server
              .getSession({ sessionId: remoteId })
              .then(
                session => ({ sessionMutable: session.isMutable, rowAgentName: session.agentName ?? undefined }),
                () => ({ sessionMutable: threadListItemIsMutable(custom), rowAgentName: agentName }),
              )
              .then(resolved => {
                // A later row click supersedes this open; New Chat / agent switches remount the runtime.
                if (selectionRef.current === selection && runtimeKeyRef.current === clickedRuntimeKey)
                  openRow(resolved);
              });
            return;
          }
          // Prefer custom.isMutable (session wire); agentName-only is a legacy fallback.
          openRow({ sessionMutable: threadListItemIsMutable(custom), rowAgentName: agentName });
        }}
        actions={
          showActions ? (
            <ThreadListItemActionsMenu
              canRename={showRename}
              renameDisabled={renameDisabled}
              canDelete={showDelete}
              deleteDisabled={deleteDisabled}
              onRename={() => setRenameOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : undefined
        }
      />
      {deleteOpen ? (
        <ConfirmDeleteDialog
          title="Delete chat"
          description={`“${displayTitle}” will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            setDeleteOpen(false);
            void Promise.resolve(aui.threadListItem().delete()).then(
              () => {
                track(AnalyticsEvents.Session.DELETED, withSessionProps(undefined, { sessionId: remoteId, agentName }));
              },
              (caught: unknown) => {
                toaster?.showError(caught);
              },
            );
          }}
        />
      ) : null}
      <RenameSessionModal
        open={renameOpen}
        initialTitle={title ?? ''}
        saving={renameSaving}
        onOpenChange={setRenameOpen}
        onSave={nextTitle => {
          void persistRename(nextTitle);
        }}
      />
    </ThreadListItemPrimitive.Root>
  );
}

function useThreadListIndicesByRecency(variant: NonNullable<ThreadListContainerProps['variant']>): number[] {
  const threadIds = useAuiState(s => s.threads.threadIds);
  const threadItems = useAuiState(s => s.threads.threadItems);

  return useMemo(() => {
    const indices = threadListIndicesByRecency({ threadIds, threadItems });
    if (variant === 'default') return indices;

    const itemById = new Map<string, (typeof threadItems)[number]>();
    for (const item of threadItems) {
      itemById.set(item.id, item);
      if (item.remoteId != null) itemById.set(item.remoteId, item);
    }

    return indices.filter(index => {
      const id = threadIds[index];
      if (id === undefined) return false;
      const item = itemById.get(id);
      return item?.remoteId != null;
    });
  }, [threadIds, threadItems, variant]);
}

function isPersistedHistoryVariant(variant: NonNullable<ThreadListContainerProps['variant']>): boolean {
  return variant === 'recent-history' || variant === 'mobile-drawer';
}

function ThreadListItemsByRecency({
  selectionRef,
  indices,
  onThreadOpen,
  canRenameSession,
  canDeleteSession,
  canManageResource,
  canDeleteResource,
}: {
  selectionRef: RefObject<number>;
  indices: number[];
  onThreadOpen?: () => void;
  canRenameSession: boolean;
  canDeleteSession: boolean;
  canManageResource: (sessionId: string) => boolean;
  canDeleteResource: (sessionId: string) => boolean;
}) {
  // Newest-first: remount/switchToThread can append the active session to threadIds.
  const threadIds = useAuiState(s => s.threads.threadIds);

  return (
    <>
      {indices.map(index => {
        const key = threadIds[index] ?? String(index);
        return (
          <ThreadListItemByIndexProvider key={key} index={index} archived={false}>
            <ThreadListItemRow
              selectionRef={selectionRef}
              onThreadOpen={onThreadOpen}
              canRenameSession={canRenameSession}
              canDeleteSession={canDeleteSession}
              canManageResource={canManageResource}
              canDeleteResource={canDeleteResource}
            />
          </ThreadListItemByIndexProvider>
        );
      })}
    </>
  );
}

const THREAD_LIST_VIEWPORT_SLOT = 'aui_thread-list-viewport';
/** How close to the bottom (px) before the next sessions page is fetched. */
const LOAD_MORE_BOTTOM_PX = 80;

function RecentChatsHeading() {
  const shell = useOptionalShellMode();
  const activeRemoteId = useAuiState(s => s.threadListItem.remoteId);
  const historyFilterIntent = shell?.historyAgentFilter?.intent;
  const showFilter =
    shell?.isLibraryEnabled === true &&
    historyFilterIntent !== 'try-agent' &&
    (historyFilterIntent === 'history' ||
      shell.mode.status !== 'active' ||
      shell.mode.isMutable ||
      shell.pendingSessionId != null ||
      activeRemoteId != null);
  const heading =
    shell?.historyAgentFilter == null ? 'Chat History' : `Chats for ${shell.historyAgentFilter.agentName}`;

  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <h2 className="aui-chat-history-heading min-w-0 flex-1 truncate px-2.5 text-xs font-medium uppercase tracking-wider">
        {heading}
      </h2>
      {showFilter ? <AgentHistoryFilterButton /> : null}
    </div>
  );
}

function RecentChatsSection({
  children,
  viewportRef,
  hideScrollbar,
  showHeading = true,
}: {
  children: ReactNode;
  viewportRef: Ref<HTMLDivElement>;
  hideScrollbar: boolean;
  /** When false, the title lives in ThreadListShell's header (recent-history desktop column). */
  showHeading?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeading ? (
        <div className="flex shrink-0 items-center gap-1 px-1 py-1">
          <RecentChatsHeading />
        </div>
      ) : null}
      <div
        ref={viewportRef}
        data-slot={THREAD_LIST_VIEWPORT_SLOT}
        className={cn(
          'relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto',
          hideScrollbar && 'aui-scrollbar-hidden',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ThreadListContainer({ onThreadOpen, variant = 'default' }: ThreadListContainerProps = {}) {
  const aui = useAui();
  const server = useOptionalServer();
  const track = useTrackAnalytics();
  const isLoading = useAuiState(s => s.threads.isLoading);
  const isLoadingMore = useAuiState(s => s.threads.isLoadingMore);
  const hasMore = useAuiState(s => s.threads.hasMore);
  const threadIds = useAuiState(s => s.threads.threadIds);
  const threadItems = useAuiState(s => s.threads.threadItems);
  const mainThreadId = useAuiState(s => s.threads.mainThreadId);
  const shell = useOptionalShellMode();

  const ThreadListShell = useSlot('ThreadListShell');
  const ThreadListNewButton = useSlot('ThreadListNewButton');
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SchedulesButton = useSlot('SchedulesButton');
  const ThreadListRowSkeleton = useSlot('ThreadListRowSkeleton');
  const ThreadListEmptyState = useSlot('ThreadListEmptyState');

  const indices = useThreadListIndicesByRecency(variant);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(hasMore);
  const auiRef = useRef(aui);
  const selectionRef = useRef(0);
  const mainThreadIsRunning = useThreadIsRunning();
  const mainThreadIsRunningRef = useRef(mainThreadIsRunning);
  hasMoreRef.current = hasMore;
  auiRef.current = aui;
  mainThreadIsRunningRef.current = mainThreadIsRunning;

  const showNewChat = shell?.isNewChatEnabled !== false;
  const isIdle = shell?.mode.status === 'idle';
  const isPersistedHistory = isPersistedHistoryVariant(variant);
  const isMobileDrawer = variant === 'mobile-drawer';
  const canRenameSession = typeof server?.renameSession === 'function';
  const canDeleteSession = typeof server?.deleteSession === 'function';
  const remoteSessionIds = useMemo(
    () => threadItems.flatMap(item => (item.remoteId == null ? [] : [item.remoteId])),
    [threadItems],
  );
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds: remoteSessionIds });

  // ponytail: first-page-only poll — rows past page 1 (or stuck server turns) never refresh;
  // upgrade via per-session status endpoint or server push.
  // The open session's status comes from the live stream, so that row alone must not arm the poll.
  const lastTurnStatusPollIntervalMs = useMemo(() => {
    if (isIdle || isLoading || server == null) return null;
    return sessionListPollIntervalMs(
      threadItems.flatMap(item => (item.id === mainThreadId ? [] : [readThreadLastTurnStatus(item.custom)])),
    );
  }, [isIdle, isLoading, mainThreadId, server, threadItems]);

  const listSessionsAgentId = shell?.listSessionsAgentId;
  useSessionListStatusPoll({
    intervalMs: lastTurnStatusPollIntervalMs,
    poll: useCallback(async () => {
      if (server == null) return;
      // Capture at request time: an in-flight listSessions started while the live turn
      // was running must not write stale `running` back after sync clears the main row.
      const startedWhileMainRunning = mainThreadIsRunningRef.current;
      try {
        const page = await server.listSessions({
          createdByMe: true,
          limit: SESSION_LIST_FIRST_PAGE_LIMIT,
          startTimestamp: sessionListStartTimestamp(),
          ...(listSessionsAgentId == null || listSessionsAgentId.length === 0 ? {} : { agentId: listSessionsAgentId }),
        });

        const statusByRemoteId = new Map(
          page.data.map(
            session =>
              [session.id, { status: session.lastTurnDetails?.state.status, updatedAt: session.updatedAt }] as const,
          ),
        );
        const threadsState = auiRef.current.threads().getState();
        const mainThreadId = threadsState.mainThreadId;
        for (const item of threadsState.threadItems) {
          // Sync owns the main row for the live turn (and for any poll that began during it).
          // Polls that start after the turn ends may refresh main if getSession fails.
          if (item.id === mainThreadId && (startedWhileMainRunning || mainThreadIsRunningRef.current)) {
            continue;
          }
          if (item.remoteId == null || !statusByRemoteId.has(item.remoteId)) continue;
          const polled = statusByRemoteId.get(item.remoteId);
          if (polled == null) continue;
          const prevStatus = readThreadLastTurnStatus(item.custom);
          const prevActivity = readThreadLastActivityAt(item.custom) ?? item.lastMessageAt;
          if (polled.status === prevStatus && !isNewerActivityAt(polled.updatedAt, prevActivity)) continue;
          void auiRef.current
            .threads()
            .item({ id: item.id })
            .updateCustom(threadCustomWithLastTurnStatus(item.custom, polled.status ?? null, polled.updatedAt));
        }
      } catch {
        // Keep showing the last known status on transient poll failures.
      }
    }, [listSessionsAgentId, server]),
  });

  // Fill an underflowing viewport; once it scrolls, paginate only near the bottom.
  // Re-measure after commit (threadIds / hasMore) instead of rAF-chaining, which
  // raced layout and could drain every remaining listSessions page.
  // The runtime owns request deduplication, so Strict Mode remounts can recheck safely.
  useEffect(() => {
    if (isIdle || isLoading || isLoadingMore) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    let cancelled = false;

    const tryLoadMore = () => {
      if (cancelled || !hasMoreRef.current) return;
      if (viewport.clientHeight <= 0) return;

      const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (viewport.scrollHeight > viewport.clientHeight && remaining > LOAD_MORE_BOTTOM_PX) return;

      void auiRef.current.threads().loadMore();
    };

    viewport.addEventListener('scroll', tryLoadMore, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => tryLoadMore());
    if (resizeObserver) {
      resizeObserver.observe(viewport);
    } else {
      window.addEventListener('resize', tryLoadMore);
    }
    tryLoadMore();

    return () => {
      cancelled = true;
      viewport.removeEventListener('scroll', tryLoadMore);
      resizeObserver?.disconnect();
      if (!resizeObserver) {
        window.removeEventListener('resize', tryLoadMore);
      }
    };
  }, [hasMore, isIdle, isLoading, isLoadingMore, threadIds.length]);

  const handleNewChat = () => {
    // No session_id yet — attaching the prior thread's id would mis-join new-chat funnels.
    track(
      AnalyticsEvents.Session.NEW,
      withSessionProps(
        { is_composer_enabled: shell?.isComposerEnabled === true },
        {
          ...(shell?.mode.status === 'active' ? { agentId: shell.mode.agentId, agentName: shell.mode.agentName } : {}),
        },
      ),
    );
    onThreadOpen?.();
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openDraft();
      return;
    }
    shell?.setSettingsOpen(false);
    shell?.setSchedulesOpen(false);
    shell?.setEnvironmentsOpen(false);
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  };

  let listBody: ReactNode;
  if (isIdle) {
    listBody = <ThreadListEmptyState message={isPersistedHistory ? 'No recent chats' : undefined} />;
  } else if (isLoading) {
    listBody = <ThreadListRowSkeleton />;
  } else if (indices.length === 0) {
    listBody = <ThreadListEmptyState message={isPersistedHistory ? 'No recent chats' : undefined} />;
  } else {
    listBody = (
      <ThreadListPrimitive.Root className="flex min-h-0 flex-col gap-0.5">
        <ThreadListItemsByRecency
          selectionRef={selectionRef}
          indices={indices}
          onThreadOpen={onThreadOpen}
          canRenameSession={canRenameSession}
          canDeleteSession={canDeleteSession}
          canManageResource={sessionId => allows(sessionId, 'MANAGE')}
          canDeleteResource={sessionId => allows(sessionId, 'DELETE')}
        />
      </ThreadListPrimitive.Root>
    );
  }

  const isRecentHistory = variant === 'recent-history';
  const header = isRecentHistory ? (
    <RecentChatsHeading />
  ) : (
    <div className="flex w-full flex-col gap-1 py-2">
      {showNewChat ? <ThreadListNewButton onClick={handleNewChat} /> : null}
      <div
        className="contents"
        onClick={() => {
          if (isMobileDrawer) onThreadOpen?.();
        }}
      >
        <AgentsLibraryButton />
      </div>
      {isMobileDrawer ? null : (
        <>
          <SessionsBrowserButton />
          <SchedulesButton />
        </>
      )}
    </div>
  );

  return (
    <ThreadListShell
      header={header}
      // Rail history: no header rule; heading + row titles share px-2.5 so they align.
      {...(isRecentHistory ? { headerClassName: 'min-h-0 border-b-0 px-0 pb-2', bodyClassName: 'p-0' } : {})}
    >
      <RecentChatsSection viewportRef={viewportRef} hideScrollbar={isPersistedHistory} showHeading={!isRecentHistory}>
        {listBody}
        {!isIdle && hasMore ? <div className="h-4 shrink-0" aria-hidden /> : null}
      </RecentChatsSection>
    </ThreadListShell>
  );
}
