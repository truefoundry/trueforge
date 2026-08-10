'use client';

import {
  ThreadListItemByIndexProvider,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';

import { AgentHistoryFilterButton } from '../atoms/AgentHistoryFilterButton.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
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
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none text-destructive hover:bg-accent hover:text-destructive focus:bg-accent focus:text-destructive data-[highlighted]:bg-accent data-[highlighted]:text-destructive';

function ThreadListItemDeleteMenu() {
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const useSheet = isMobile || compact;

  const moreButtonClass = auiButtonClass({
    variant: 'ghost',
    size: 'icon',
    className: 'size-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground',
  });

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
        aria-label="Session actions"
        title="Session actions"
        className={moreButtonClass}
      >
        <Icon name="ellipsis" className="size-3.5" />
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        align="end"
        sideOffset={4}
        className="z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
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
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setExpanded(v => !v)}
        >
          <span className="truncate">Chat History</span>
          <Icon
            name="chevron-down"
            className={cn('size-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')}
          />
        </button>
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
  const hasMore = useAuiState(s => s.threads.hasMore);
  const threadIds = useAuiState(s => s.threads.threadIds);
  const shell = useOptionalShellMode();

  const ThreadListShell = useSlot('ThreadListShell');
  const ThreadListNewButton = useSlot('ThreadListNewButton');
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const ThreadListRowSkeleton = useSlot('ThreadListRowSkeleton');
  const ThreadListEmptyState = useSlot('ThreadListEmptyState');

  const viewportRef = useRef<HTMLDivElement>(null);
  const loadMoreInflightRef = useRef(false);
  const hasMoreRef = useRef(hasMore);
  const auiRef = useRef(aui);
  hasMoreRef.current = hasMore;
  auiRef.current = aui;

  const showNewChat = shell?.isNewChatEnabled !== false;
  const isIdle = shell?.mode.status === 'idle';
  const canDeleteSession = typeof server?.deleteSession === 'function';

  // Scroll-driven pagination only — never auto-chain pages while the sentinel
  // is visible on mount (that drained every listSessions page).
  useEffect(() => {
    if (isIdle) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    let cancelled = false;
    let chainRaf = 0;

    const tryLoadMore = () => {
      if (cancelled || !hasMoreRef.current || loadMoreInflightRef.current) return;
      // Require a real scroll so a short first page does not fill-drain the cursor.
      if (viewport.scrollTop <= 0) return;
      const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (remaining > LOAD_MORE_BOTTOM_PX) return;

      loadMoreInflightRef.current = true;
      void Promise.resolve(auiRef.current.threads().loadMore()).finally(() => {
        loadMoreInflightRef.current = false;
        if (cancelled) return;
        // Still glued to the bottom after append → fetch the next page.
        chainRaf = requestAnimationFrame(() => tryLoadMore());
      });
    };

    viewport.addEventListener('scroll', tryLoadMore, { passive: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(chainRaf);
      viewport.removeEventListener('scroll', tryLoadMore);
    };
  }, [isIdle]);

  const handleNewChat = () => {
    onThreadOpen?.();
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
          <AgentsLibraryButton
            onSelectAgent={() => {
              onThreadOpen?.();
            }}
          />
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
