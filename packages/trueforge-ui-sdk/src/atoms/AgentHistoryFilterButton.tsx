'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { useCompactLayout } from './lib/CompactLayoutContext.js';
import { useIsMobile } from './lib/useIsMobile.js';
import { BottomSheet } from './primitives/BottomSheet.js';
import SearchInput from './primitives/SearchInput.js';

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
  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = shell?.isLibraryEnabled === true && server != null;
  const selected = shell?.historyAgentFilter ?? null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (!server) return;
    let cancelled = false;
    setLoading(true);
    void server
      .searchAgents({ query: query.trim() || undefined, limit: 50 })
      .then(rows => {
        if (!cancelled) setAgents(rows);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, server]);

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
      </div>
      <div className={cn('mt-1 overflow-y-auto', useSheet ? 'min-h-0 flex-1 px-1 pb-2' : 'max-h-64')}>
        <button
          type="button"
          role="menuitem"
          className={cn(
            'flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none',
            'hover:bg-accent hover:text-accent-foreground',
            selected == null && 'bg-accent',
          )}
          onClick={() => pick(null)}
        >
          All chats
          {selected == null ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
        </button>
        {loading ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          agents.map(agent => {
            const active = selected === agent.agentId;
            return (
              <button
                key={agent.agentId}
                type="button"
                role="menuitem"
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                  'hover:bg-accent hover:text-accent-foreground',
                  active && 'bg-accent',
                )}
                onClick={() => pick(agent.agentId)}
              >
                <span className="min-w-0 truncate">{agent.name}</span>
                {active ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Filter chat history by agent"
        aria-haspopup={useSheet ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Filter by agent"
        className={auiButtonClass({
          variant: 'ghost',
          size: 'icon',
          className: cn(
            'size-7 text-muted-foreground hover:bg-accent hover:text-foreground',
            selected != null && 'text-foreground',
          ),
        })}
        onClick={() => setOpen(v => !v)}
      >
        <Icon name="funnel" className="size-3.5" />
      </button>
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
              className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {filterBody}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
