import { useAui, useAuiState } from '@assistant-ui/react';
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, PencilSquareIcon } from './icons';

function relativeTime(date: Date | undefined, nowMs: number): string | null {
  if (!date) return null;
  const diffMs = nowMs - date.getTime();
  if (diffMs < 60_000) return 'now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Chat history sidebar. Owns the thread list directly (instead of the SDK's
 * ThreadListContainer) so rows can show last-activity time, which the SDK
 * row slot does not receive. Selection-only — no archive/delete.
 */
export function ThreadSidebar() {
  const aui = useAui();
  const isLoading = useAuiState(state => state.threads.isLoading);
  const isLoadingMore = useAuiState(state => state.threads.isLoadingMore);
  const hasMore = useAuiState(state => state.threads.hasMore);
  const threadIds = useAuiState(state => state.threads.threadIds);
  const threadItems = useAuiState(state => state.threads.threadItems);
  const mainThreadId = useAuiState(state => state.threads.mainThreadId);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Keep relative times fresh ("now" -> "1m" -> ...).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !isLoadingMore) {
        void aui.threads().loadMore();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [aui, hasMore, isLoadingMore]);

  const itemsById = new Map(threadItems.map(item => [item.id, item]));
  // Rows are keyed by remote id after a list reload, but a locally started
  // thread keeps a local mainThreadId; compare against its remoteId too.
  const mainRemoteId = itemsById.get(mainThreadId)?.remoteId;

  return (
    <div className="sidebar-shell">
      <div className="sidebar-nav">
        <button
          type="button"
          className="sidebar-new-chat"
          onClick={() => {
            aui.threads().switchToNewThread();
          }}
        >
          <PencilSquareIcon />
          New Chat
        </button>
      </div>
      <div className="sidebar-history-label">
        <span>
          Chat History
          <ChevronDownIcon />
        </span>
      </div>
      <div className="sidebar-history-list">
        {!isLoading && threadIds.length === 0 ? <div className="sidebar-empty">No chats yet.</div> : null}
        {threadIds.map(id => {
          const item = itemsById.get(id);
          const title = item?.title ?? 'New Chat';
          const time = relativeTime(item?.lastMessageAt, nowMs);
          const isActive = id === mainThreadId || id === mainRemoteId;
          return (
            <button
              key={id}
              type="button"
              className="sidebar-row"
              data-active={isActive || undefined}
              aria-current={isActive ? 'page' : undefined}
              title={title}
              onClick={() => {
                aui.threads().switchToThread(id);
              }}
            >
              <span className="sidebar-row-title">{title}</span>
              {time ? <span className="sidebar-row-time">{time}</span> : null}
            </button>
          );
        })}
        {hasMore ? <div ref={sentinelRef} aria-hidden /> : null}
      </div>
    </div>
  );
}
