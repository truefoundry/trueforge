'use client';

import {
  ThreadListItemByIndexProvider,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';

import { AgentHistoryFilterButton } from '../atoms/AgentHistoryFilterButton.js';
import { cn } from '../atoms/lib/cn.js';
import { useCompactLayout } from '../atoms/lib/CompactLayoutContext.js';
import {
  canReuseMutableShell,
  readThreadAgentName,
  threadListIndicesByRecency,
  threadListItemIsMutable,
} from '../atoms/lib/threadListMeta.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { BottomSheet } from '../atoms/primitives/BottomSheet.js';
import { Button } from '../atoms/primitives/Button.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

/**
 * Simplified relative to the reference: renders threads in a single flat list
 * rather than grouping them by Today/Yesterday/Earlier.
 *
 * Delete uses assistant-ui ThreadListItemPrimitive.Delete / ThreadListItemMorePrimitive
 * (adapter.delete → server.deleteSession). Mobile/compact keeps a BottomSheet chrome.
 */
export type ThreadListContainerProps = {
  /** Called after New chat or selecting a row — used by stack/drawer chrome. */
  onThreadOpen?: () => void;
};

const deleteItemClass =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-failure-bg outline-none transition-colors hover:bg-failure-bg/12 hover:text-failure-bg focus:bg-failure-bg/12 focus:text-failure-bg data-[highlighted]:bg-failure-bg/12 data-[highlighted]:text-failure-bg';

function ThreadListItemDeleteMenu() {
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const useSheet = isMobile || compact;
  const setTriggerElement = useCallback((element: HTMLButtonElement | null) => {
    const themeRoot = element?.closest('.aui-theme-root');
    setPortalContainer(themeRoot instanceof HTMLElement ? themeRoot : undefined);
  }, []);

  const moreButtonClass =
    'inline-flex aspect-square size-7 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md bg-ghost-button-bg px-0 text-xs font-medium text-text-secondary transition-colors hover:bg-transparent hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

  if (useSheet) {
    return (
      <>
        <Button.Ghost
          type="button"
          aria-label="Session actions"
          title="Session actions"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          size="small"
          className={moreButtonClass}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="ellipsis" className="size-3.5" />
        </Button.Ghost>
        {sheetOpen ? (
          <BottomSheet open onOpenChange={setSheetOpen} aria-label="Session actions">
            <div className="flex flex-col gap-1 p-2" role="menu">
              <ThreadListItemPrimitive.Delete className={deleteItemClass} onClick={() => setSheetOpen(false)}>
                <Icon name="trash" className="size-3.5" />
                Delete
              </ThreadListItemPrimitive.Delete>
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
        className="font-sans-flex z-50 min-w-[8rem] rounded-md border border-border bg-card-bg p-1 text-text-primary shadow-md"
      >
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item className={deleteItemClass}>
            <Icon name="trash" className="size-3.5" />
            Delete
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
}

function ThreadListItemRow({
  onThreadOpen,
  canDeleteSession,
}: {
  onThreadOpen?: () => void;
  canDeleteSession: boolean;
}) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const ThreadListRow = useSlot('ThreadListRow');
  const id = useAuiState(s => s.threadListItem.id);
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const lastMessageAt = useAuiState(s => s.threadListItem.lastMessageAt);
  const custom = useAuiState(s => s.threadListItem.custom);
  const mainThreadId = useAuiState(s => s.threads.mainThreadId);
  const agentName = readThreadAgentName(custom);
  const showDelete = canDeleteSession && remoteId != null;

  return (
    <ThreadListItemPrimitive.Root className="min-w-0">
      <ThreadListRow
        title={title ?? 'New Chat'}
        active={id === mainThreadId}
        agentName={agentName}
        lastMessageAt={lastMessageAt}
        onSelect={() => {
          onThreadOpen?.();
          shell?.setSettingsOpen(false);
          shell?.setLibraryOpen(false);
          shell?.setSessionsOpen(false);

          // Prefer custom.isMutable (session wire); agentName-only is a legacy fallback.
          const sessionMutable = threadListItemIsMutable(custom);
          const sameImmutable =
            !sessionMutable &&
            shell?.mode.status === 'active' &&
            !shell.mode.isMutable &&
            (agentName == null
              ? shell.mode.agentName == null && shell.mode.agentId == null
              : shell.mode.agentName === agentName || shell.mode.agentId === agentName);
          const sameMutable = canReuseMutableShell({
            sessionMutable,
            shellMutable: shell?.mode.status === 'active' && shell.mode.isMutable,
            ...(shell?.mode.status === 'active' && shell.mode.isMutable
              ? { shellAgentName: shell.mode.agentName, shellAgentId: shell.mode.agentId }
              : {}),
            remoteId,
            pendingSessionId: shell?.pendingSessionId,
          });

          if ((sameImmutable || sameMutable) && remoteId != null) {
            void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
            return;
          }
          if (remoteId != null) {
            shell?.openHistorySession({
              sessionId: remoteId,
              isMutable: sessionMutable,
              ...(agentName != null ? { agentName } : {}),
            });
            return;
          }
          void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
        }}
        actions={showDelete ? <ThreadListItemDeleteMenu /> : undefined}
      />
    </ThreadListItemPrimitive.Root>
  );
}

function useThreadListIndicesByRecency(): number[] {
  const threadIds = useAuiState(s => s.threads.threadIds);
  const threadItems = useAuiState(s => s.threads.threadItems);

  return useMemo(() => threadListIndicesByRecency({ threadIds, threadItems }), [threadIds, threadItems]);
}

function ThreadListItemsByRecency({
  onThreadOpen,
  canDeleteSession,
}: {
  onThreadOpen?: () => void;
  canDeleteSession: boolean;
}) {
  // Newest-first: remount/switchToThread can append the active session to threadIds.
  const indices = useThreadListIndicesByRecency();
  const threadIds = useAuiState(s => s.threads.threadIds);

  return (
    <>
      {indices.map(index => {
        const key = threadIds[index] ?? String(index);
        return (
          <ThreadListItemByIndexProvider key={key} index={index} archived={false}>
            <ThreadListItemRow onThreadOpen={onThreadOpen} canDeleteSession={canDeleteSession} />
          </ThreadListItemByIndexProvider>
        );
      })}
    </>
  );
}

const THREAD_LIST_VIEWPORT_SLOT = 'aui_thread-list-viewport';
/** How close to the bottom (px) before the next sessions page is fetched. */
const LOAD_MORE_BOTTOM_PX = 80;

function ChatHistorySection({ children, viewportRef }: { children: ReactNode; viewportRef: Ref<HTMLDivElement> }) {
  const [expanded, setExpanded] = useState(true);
  const shell = useOptionalShellMode();
  const showFilter = shell?.isLibraryEnabled === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-1 py-1">
        <Button.Ghost
          type="button"
          aria-expanded={expanded}
          className="h-auto min-w-0 flex-1 justify-start gap-1 px-1.5 py-1 text-left text-sm text-text-secondary shadow-none hover:bg-ghost-button-hover hover:text-text-primary"
          onClick={() => setExpanded(v => !v)}
        >
          <span className="truncate">Chat History</span>
          <Icon
            name="chevron-down"
            className={cn('size-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')}
          />
        </Button.Ghost>
        {showFilter ? <AgentHistoryFilterButton /> : null}
      </div>
      {expanded ? (
        <div
          ref={viewportRef}
          data-slot={THREAD_LIST_VIEWPORT_SLOT}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadListContainer({ onThreadOpen }: ThreadListContainerProps = {}) {
  const aui = useAui();
  const server = useOptionalServer();
  const isLoading = useAuiState(s => s.threads.isLoading);
  const isLoadingMore = useAuiState(s => s.threads.isLoadingMore);
  const hasMore = useAuiState(s => s.threads.hasMore);
  const threadIds = useAuiState(s => s.threads.threadIds);
  const shell = useOptionalShellMode();

  const ThreadListShell = useSlot('ThreadListShell');
  const ThreadListNewButton = useSlot('ThreadListNewButton');
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const ThreadListRowSkeleton = useSlot('ThreadListRowSkeleton');
  const ThreadListEmptyState = useSlot('ThreadListEmptyState');

  const viewportRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(hasMore);
  const auiRef = useRef(aui);
  hasMoreRef.current = hasMore;
  auiRef.current = aui;

  const showNewChat = shell?.isNewChatEnabled !== false;
  const isIdle = shell?.mode.status === 'idle';
  const canDeleteSession = typeof server?.deleteSession === 'function';

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
    onThreadOpen?.();
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openDraft();
      return;
    }
    shell?.setSettingsOpen(false);
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  };

  let listBody: ReactNode;
  if (isIdle) {
    listBody = <ThreadListEmptyState />;
  } else if (isLoading) {
    listBody = <ThreadListRowSkeleton />;
  } else if (threadIds.length === 0) {
    listBody = <ThreadListEmptyState />;
  } else {
    listBody = (
      <ThreadListPrimitive.Root className="flex min-h-0 flex-col gap-0.5">
        <ThreadListItemsByRecency onThreadOpen={onThreadOpen} canDeleteSession={canDeleteSession} />
      </ThreadListPrimitive.Root>
    );
  }

  return (
    <ThreadListShell
      header={
        <div className="flex flex-col gap-1">
          {showNewChat ? <ThreadListNewButton onClick={handleNewChat} /> : null}
          <AgentsLibraryButton />
          <SessionsBrowserButton />
        </div>
      }
    >
      <ChatHistorySection viewportRef={viewportRef}>
        {listBody}
        {!isIdle && hasMore ? <div className="h-4 shrink-0" aria-hidden /> : null}
      </ChatHistorySection>
    </ThreadListShell>
  );
}
