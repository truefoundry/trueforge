'use client';

import { ThreadListItemByIndexProvider, useAuiState } from '@assistant-ui/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useThreadListItemSelect } from '../hooks/useThreadListItemSelect.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { threadListIndicesByRecency } from './lib/threadListMeta.js';

export type ChatHistorySearchButtonProps = {
  onThreadOpen?: () => void;
  variant?: 'default' | 'recent-history' | 'mobile-drawer';
};

function titleMatchesQuery({ title, query }: { title: string | undefined; query: string }): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (title ?? 'New Chat').toLowerCase().includes(needle);
}

function ChatHistorySearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hasQuery = query.length > 0;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onOpenChange(false);
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-label="Search chat history"
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }}
      onClick={event => {
        if (event.target === dialogRef.current) onOpenChange(false);
      }}
      className={cn(
        'm-auto w-[min(32rem,calc(100%-2rem))] max-h-[min(36rem,80dvh)]',
        'open:flex open:flex-col overflow-hidden rounded-2xl border border-border bg-card-bg p-0 text-text-primary shadow-xl',
        'backdrop:bg-[var(--overlay)]',
      )}
    >
      <h2 id={titleId} className="sr-only">
        Search chat history
      </h2>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="Search..."
          aria-label="Search chat history"
          className={cn(
            'min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none',
            'placeholder:text-text-secondary/70',
            '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          )}
        />
        {hasQuery ? (
          <>
            <button
              type="button"
              className="shrink-0 cursor-pointer px-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
              onClick={() => onQueryChange('')}
            >
              Clear
            </button>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
          </>
        ) : null}
        <button
          type="button"
          aria-label="Close"
          title="Close"
          className={auiButtonClass({
            variant: 'ghost',
            size: 'icon',
            className: 'size-7 shrink-0 text-text-secondary hover:bg-ghost-button-hover hover:text-text-primary',
          })}
          onClick={() => onOpenChange(false)}
        >
          <Icon name="xmark" className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1 pb-3">{children}</div>
    </dialog>
  );
}

function ChatHistorySearchResultRow({
  selectionRef,
  onThreadOpen,
  onPicked,
}: {
  selectionRef: RefObject<number>;
  onThreadOpen?: () => void;
  onPicked: () => void;
}) {
  const { displayTitle, select } = useThreadListItemSelect({ selectionRef, onThreadOpen });

  return (
    <button
      type="button"
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-text-primary',
        'transition-colors hover:bg-ghost-button-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring',
      )}
      onClick={() => {
        select();
        onPicked();
      }}
    >
      <Icon name="message-circle" className="size-4 shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
    </button>
  );
}

/**
 * Magnifying-glass on the Chat History heading. Opens a centered popup of loaded
 * sessions and filters them locally by title.
 */
export function ChatHistorySearchButton({
  onThreadOpen,
  variant = 'recent-history',
}: ChatHistorySearchButtonProps = {}) {
  const track = useTrackAnalytics();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectionRef = useRef(0);

  const threadIds = useAuiState(s => s.threads.threadIds);
  const threadItems = useAuiState(s => s.threads.threadItems);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const indices = useMemo(() => {
    const byRecency = threadListIndicesByRecency({ threadIds, threadItems });
    const itemById = new Map<string, (typeof threadItems)[number]>();
    for (const item of threadItems) {
      itemById.set(item.id, item);
      if (item.remoteId != null) itemById.set(item.remoteId, item);
    }

    return byRecency.filter(index => {
      const id = threadIds[index];
      if (id === undefined) return false;
      const item = itemById.get(id);
      if (item == null) return false;
      if (variant !== 'default' && item.remoteId == null) return false;
      return titleMatchesQuery({ title: item.title, query });
    });
  }, [query, threadIds, threadItems, variant]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) track(AnalyticsEvents.Session.HISTORY_SEARCH_OPENED);
  };

  const sectionLabel = query.trim().length === 0 ? 'Recent chats' : 'Results';

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Search chat history"
        title="Search chat history"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={auiButtonClass({
          variant: 'ghost',
          size: 'icon',
          className: 'size-7 shrink-0 text-text-secondary hover:bg-ghost-button-hover hover:text-ghost-button-text',
        })}
        onClick={() => handleOpenChange(true)}
      >
        <Icon name="search" className="size-3.5" />
      </button>
      {open ? (
        <ChatHistorySearchDialog open onOpenChange={handleOpenChange} query={query} onQueryChange={setQuery}>
          {indices.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-secondary" role="status">
              {query.trim().length > 0 ? `No chats match “${query.trim()}”.` : 'No recent chats'}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="px-3 pb-1.5 text-xs font-medium text-text-secondary">{sectionLabel}</p>
              {indices.map(index => {
                const key = threadIds[index] ?? String(index);
                return (
                  <ThreadListItemByIndexProvider key={key} index={index} archived={false}>
                    <ChatHistorySearchResultRow
                      selectionRef={selectionRef}
                      onThreadOpen={onThreadOpen}
                      onPicked={() => handleOpenChange(false)}
                    />
                  </ThreadListItemByIndexProvider>
                );
              })}
            </div>
          )}
        </ChatHistorySearchDialog>
      ) : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ChatHistorySearchButton: typeof ChatHistorySearchButton;
  }
}
