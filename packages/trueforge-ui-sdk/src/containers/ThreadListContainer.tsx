'use client';

import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { useCompactLayout } from '../atoms/lib/CompactLayoutContext.js';
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
    className: cn(
      'size-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground',
      'opacity-100 transition-opacity',
      !compact && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
      'focus-visible:opacity-100 data-[state=open]:opacity-100',
    ),
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

function ThreadListItemRow({ onThreadOpen, showDelete }: { onThreadOpen?: () => void; showDelete: boolean }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const ThreadListRow = useSlot('ThreadListRow');
  const id = useAuiState(s => s.threadListItem.id);
  const title = useAuiState(s => s.threadListItem.title);
  const mainThreadId = useAuiState(s => s.threads.mainThreadId);

  return (
    <ThreadListItemPrimitive.Root className="min-w-0">
      <ThreadListRow
        title={title ?? 'New Chat'}
        active={id === mainThreadId}
        onSelect={() => {
          onThreadOpen?.();
          shell?.setSettingsOpen(false);
          void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
        }}
        actions={showDelete ? <ThreadListItemDeleteMenu /> : undefined}
      />
    </ThreadListItemPrimitive.Root>
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
  const ThreadListRowSkeleton = useSlot('ThreadListRowSkeleton');
  const ThreadListEmptyState = useSlot('ThreadListEmptyState');

  const sentinelRef = useRef<HTMLDivElement>(null);
  const showNewChat = shell?.isNewChatEnabled !== false;
  const isIdle = shell?.mode.type === 'idle';
  const canDeleteSession = typeof server?.deleteSession === 'function';

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isIdle) return;

    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && hasMore && !isLoadingMore) {
        void aui.threads().loadMore();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [aui, hasMore, isLoadingMore, isIdle]);

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
        <ThreadListPrimitive.Items>
          {({ threadListItem }) => (
            <ThreadListItemRow
              onThreadOpen={onThreadOpen}
              showDelete={canDeleteSession && threadListItem.remoteId != null}
            />
          )}
        </ThreadListPrimitive.Items>
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
      {listBody}
      {!isIdle && hasMore ? <div ref={sentinelRef} className="h-4 shrink-0" aria-hidden /> : null}
    </ThreadListShell>
  );
}
