'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../icons/Icon.js';
import { libraryAgentId } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { cn } from './lib/cn.js';
import { auiSelectMenuClass, auiSelectOptionClass, auiSelectTriggerClass } from './lib/selectClasses.js';
import { themePortalRoot } from './lib/themePortalRoot.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { Button } from './primitives/Button.js';

export type AgentSearchPickerProps = {
  value: string;
  selectedLabel: string;
  onValueChange: (agentId: string) => void;
  onAgentPicked?: (agent: AgentLibraryEntry) => void;
  disabled?: boolean;
  onBuildAgent?: () => void;
  'aria-label'?: string;
  placeholder?: string;
  className?: string;
};

/**
 * Combobox agent picker: type in the field to filter via debounced `searchAgents`.
 */
export function AgentSearchPicker({
  value,
  selectedLabel,
  onValueChange,
  onAgentPicked,
  disabled = false,
  onBuildAgent,
  'aria-label': ariaLabel = 'Agent',
  placeholder = 'Search agent',
  className,
}: AgentSearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const { agents, isInitialLoading, isSearching, loadingMore, hasMore, error, listRef, sentinelRef } =
    useSearchAgentsList({
      enabled: open && !disabled,
      query,
    });

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const pick = (agent: AgentLibraryEntry) => {
    const id = libraryAgentId(agent);
    onValueChange(id);
    onAgentPicked?.(agent);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const inputValue = open ? query : selectedLabel;
  const queryTrimmed = query.trim();
  const showError = !isInitialLoading && error != null;
  const showEmptyCatalog = !isInitialLoading && error == null && agents.length === 0 && queryTrimmed === '';
  const showNoMatch = !isInitialLoading && error == null && agents.length === 0 && queryTrimmed !== '';

  const menu =
    open && pos != null && !disabled
      ? createPortal(
          <div
            ref={menuRef}
            className={auiSelectMenuClass('fixed z-[200] flex max-h-64 flex-col overflow-hidden')}
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            onMouseDown={event => event.stopPropagation()}
          >
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {isInitialLoading ? (
                <p className="text-text-secondary px-3 py-5 text-center text-sm" role="status">
                  Loading…
                </p>
              ) : showError ? (
                <p className="text-failure-bg px-3 py-5 text-center text-sm" role="alert">
                  {error}
                </p>
              ) : showEmptyCatalog ? (
                <p className="text-text-secondary px-3 py-5 text-center text-sm">No Agents created yet</p>
              ) : showNoMatch ? (
                <p className="text-text-secondary px-3 py-5 text-center text-sm" role="status">
                  No agents match &quot;{queryTrimmed}&quot;.
                </p>
              ) : (
                <>
                  {isSearching ? (
                    <p className="sr-only" role="status">
                      Searching…
                    </p>
                  ) : null}
                  {agents.map(agent => {
                    const id = libraryAgentId(agent);
                    const selected = value === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={auiSelectOptionClass()}
                        onClick={() => pick(agent)}
                      >
                        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                        <Icon
                          name="check"
                          className={cn('ml-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                        />
                      </button>
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
            {showEmptyCatalog && onBuildAgent != null ? (
              <div className="flex justify-end border-t border-border px-2 pt-2">
                <Button.Ghost type="button" onClick={onBuildAgent}>
                  <Icon name="plus" className="size-3.5" />
                  Build Agent
                </Button.Ghost>
              </div>
            ) : null}
          </div>,
          themePortalRoot(rootRef.current),
        )
      : null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        ref={triggerRef}
        className={auiSelectTriggerClass(disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text')}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-secondary/70 disabled:cursor-not-allowed"
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={event => {
            if (disabled) return;
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              inputRef.current?.blur();
              return;
            }
            if (event.key === 'ArrowDown' && !open && !disabled) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        <Icon name="chevron-down" className="size-4 shrink-0 text-text-secondary" />
      </div>
      {menu}
    </div>
  );
}
