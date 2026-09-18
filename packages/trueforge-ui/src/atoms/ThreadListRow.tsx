'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { formatRelativeShort, MAX_SESSION_TITLE_LENGTH } from './lib/threadListMeta.js';

export type ThreadListRowProps = {
  title: string;
  active: boolean;
  onSelect: () => void;
  /** Named-agent label under the title (from session.agentName). */
  agentName?: string;
  /** Shown as compact relative time on the right. */
  lastMessageAt?: Date;
  /** Overflow actions (e.g. rename / delete menu) — rendered as a sibling of the title button. */
  actions?: ReactNode;
  renaming?: boolean;
  renameValue?: string;
  renameSaving?: boolean;
  onRenameValueChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onRenameBlur?: () => void;
  className?: string;
};

function ThreadListAgentName({ agentName }: { agentName: string }) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.75rem] text-text-secondary">
      <Icon name="bot" className="shrink-0" />
      <span className="truncate">{agentName}</span>
    </span>
  );
}

function ThreadListRenameField({
  title,
  renameValue,
  renameSaving,
  agentName,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameBlur,
}: {
  title: string;
  renameValue?: string;
  renameSaving: boolean;
  agentName?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onRenameBlur?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input == null) return;
    input.focus();
    input.select();
  }, []);

  return (
    <div className="min-h-8 min-w-0 flex-1 overflow-hidden px-2.5 py-1.5">
      <input
        ref={inputRef}
        aria-label="Session title"
        value={renameValue ?? title}
        readOnly={renameSaving}
        maxLength={MAX_SESSION_TITLE_LENGTH}
        className="h-7 w-full cursor-text border-none bg-transparent text-sm text-text-primary outline-none focus:ring-0 focus-visible:ring-0"
        onChange={event => onRenameValueChange?.(event.target.value)}
        onBlur={() => onRenameBlur?.()}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onRenameCommit?.();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onRenameCancel?.();
          }
        }}
      />
      {agentName != null ? <ThreadListAgentName agentName={agentName} /> : null}
    </div>
  );
}

export function ThreadListRow({
  title,
  active,
  onSelect,
  agentName,
  lastMessageAt,
  actions,
  renaming = false,
  renameValue,
  renameSaving = false,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameBlur,
  className,
}: ThreadListRowProps) {
  const relative = lastMessageAt != null ? formatRelativeShort(lastMessageAt) : undefined;
  const hasTrailing = !renaming && (relative != null || actions != null);

  return (
    <div
      data-slot="aui_thread-list-item"
      data-active={(!renaming && active) || undefined}
      className={cn(
        'group flex min-w-0 items-center gap-0.5 rounded-[0.5rem] transition-colors',
        renaming
          ? 'text-text-secondary'
          : active
            ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
            : 'text-text-secondary hover:bg-ghost-button-hover hover:text-text-primary',
        className,
      )}
    >
      {renaming ? (
        <ThreadListRenameField
          title={title}
          renameValue={renameValue}
          renameSaving={renameSaving}
          agentName={agentName}
          onRenameValueChange={onRenameValueChange}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onRenameBlur={onRenameBlur}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          style={{ borderRadius: 'var(--thread-list-item-radius, 0.75rem)' }}
          className={auiButtonClass({
            variant: 'ghost',
            className: cn(
              '!justify-start h-auto min-h-8 min-w-0 flex-1 overflow-hidden rounded-[0.75rem] px-2.5 py-1.5 text-left font-normal shadow-none',
              'bg-transparent hover:bg-transparent hover:text-inherit',
              active ? 'text-dropdown-selected-item-text' : 'text-inherit',
            ),
          })}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-normal text-text-primary">{title}</span>
            {agentName != null ? <ThreadListAgentName agentName={agentName} /> : null}
          </span>
        </button>
      )}
      {hasTrailing ? (
        <div className="relative mr-1 flex size-7 shrink-0 items-center justify-center">
          {relative != null ? (
            <span
              data-slot="aui_thread-list-item-age"
              className={cn(
                'pointer-events-none text-xs text-text-secondary transition-opacity',
                // md: variants survive host Tailwind tree-shaking (same set as AgentsLibrary).
                // Bare group-hover:opacity-* is dropped from the example CSS bundle.
                actions != null &&
                  'opacity-0 md:opacity-100 md:group-hover:opacity-0 md:group-focus-within:opacity-0 md:group-has-[[data-state=open]]:opacity-0',
              )}
            >
              {relative}
            </span>
          ) : null}
          {actions != null ? (
            <div
              data-slot="aui_thread-list-item-actions"
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity',
                relative != null &&
                  'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-has-[[data-state=open]]:opacity-100',
              )}
            >
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ThreadListRow: typeof ThreadListRow;
  }
}
