'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { libraryAgentId, useOptionalShellMode } from '../server/ShellModeContext.js';
import { cn } from './lib/cn.js';
import { useCompactLayout } from './lib/CompactLayoutContext.js';
import { useIsMobile } from './lib/useIsMobile.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { BottomSheet } from './primitives/BottomSheet.js';
import { Button } from './primitives/Button.js';
import { DropdownMenuItem } from './primitives/DropdownMenu.js';
import SearchInput from './primitives/SearchInput.js';

/** Keep portaled chrome under ThemeProvider so preset/custom CSS vars still apply. */
function themePortalRoot(from: HTMLElement | null): HTMLElement {
  return from?.closest('.aui-theme-root') ?? document.body;
}

/**
 * Funnel popover for filtering chat history by agent id.
 * Desktop: fixed menu to the right of the funnel. Mobile/compact: bottom sheet.
 */
export function AgentHistoryFilterButton() {
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const isMobile = useIsMobile();
  const compact = useCompactLayout();
  const useSheet = isMobile || compact;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = shell?.isLibraryEnabled === true && server != null;
  const selected = shell?.historyAgentFilter ?? null;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { agents, isInitialLoading, isSearching, loadingMore, hasMore, listRef, sentinelRef } = useSearchAgentsList({
    enabled: open && enabled,
    query,
  });

  // Desktop only: anchor to the right of the funnel; portal escapes sidebar overflow.
  useLayoutEffect(() => {
    if (!open || useSheet) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({ top: rect.top, left: rect.right + 4 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, useSheet]);

  useEffect(() => {
    if (!open || useSheet) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, useSheet]);

  if (!enabled) return null;

  const pick = (agentId: string | null) => {
    shell?.setHistoryAgentFilter(agentId);
    setOpen(false);
  };

  const filterBody = (
    <>
      <div className="p-1" onMouseDown={e => e.stopPropagation()}>
        <SearchInput query={query} setQuery={setQuery} placeholder="Search agents" />
        {isSearching ? (
          <p className="text-text-secondary px-1 pt-1 text-[11px]" role="status">
            Searching…
          </p>
        ) : null}
      </div>
      <div
        ref={listRef}
        className={cn('mt-1 overflow-y-auto', useSheet ? 'min-h-0 flex-1 px-1 pb-2' : 'min-h-48 max-h-64')}
      >
        {query.trim() === '' ? (
          <DropdownMenuItem
            className={cn(
              'justify-between',
              selected == null && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
            )}
            onClick={() => pick(null)}
          >
            All chats
            {selected == null ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ) : null}
        {isInitialLoading ? (
          <p className="px-2 py-3 text-center text-xs text-text-secondary">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="text-text-secondary px-2 py-6 text-center text-xs" role="status">
            {query.trim() ? `No agents match "${query.trim()}".` : 'No agents yet.'}
          </p>
        ) : (
          <>
            {agents.map(agent => {
              const id = libraryAgentId(agent);
              const active = selected === id;
              return (
                <DropdownMenuItem
                  key={id}
                  className={cn(
                    'justify-between gap-2 text-left',
                    active && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
                  )}
                  onClick={() => pick(id)}
                >
                  <span className="min-w-0 truncate">{agent.name}</span>
                  {active ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
                </DropdownMenuItem>
              );
            })}
            {hasMore ? (
              <div ref={sentinelRef} className="flex h-6 shrink-0 items-center justify-center" aria-hidden>
                {loadingMore ? (
                  <span className="text-text-secondary text-[11px]" role="status">
                    Loading more…
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="relative shrink-0">
      <Button.Ghost
        ref={buttonRef}
        type="button"
        aria-label={selected != null ? `Filter chat history by agent (${selected})` : 'Filter chat history by agent'}
        aria-haspopup={useSheet ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Filter by agent"
        size="small"
        className={cn(
          'relative aspect-square size-7 shrink-0 px-0 text-text-secondary hover:bg-ghost-button-hover hover:text-ghost-button-text',
          selected != null && 'text-text-primary',
        )}
        onClick={() => setOpen(v => !v)}
      >
        <Icon name="funnel" className="size-3.5" />
        {selected != null ? (
          <span
            className="bg-primary-button-bg absolute top-1 right-1 size-1.5 rounded-full"
            aria-hidden
            data-testid="history-filter-active-dot"
          />
        ) : null}
      </Button.Ghost>
      {useSheet && open ? (
        <BottomSheet open onOpenChange={setOpen} id={menuId} aria-label="Filter agents">
          <div className="flex min-h-0 flex-1 flex-col p-2" role="menu">
            {filterBody}
          </div>
        </BottomSheet>
      ) : null}
      {!useSheet && open && menuPos != null
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Filter agents"
              style={{ top: menuPos.top, left: menuPos.left }}
              className="font-sans-flex fixed z-50 w-56 rounded-md border border-border bg-card-bg p-1 text-text-primary shadow-md"
            >
              {filterBody}
            </div>,
            themePortalRoot(buttonRef.current),
          )
        : null}
    </div>
  );
}
