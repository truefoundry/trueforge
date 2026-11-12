'use client';

import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import type { TurnStatus } from '../server/types.js';
import { StatusDot } from './agent-chat/StatusDot.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import {
  formatRelativeShort,
  isPausedTurnStatus,
  isRunningTurnStatus,
  lastTurnStatusDotClass,
  lastTurnStatusLabel,
} from './lib/threadListMeta.js';
import { useIsMobile } from './lib/useIsMobile.js';
import { Tooltip } from './primitives/Tooltip.js';

export type ThreadListRowProps = {
  title: string;
  active: boolean;
  onSelect: () => void;
  /** Named-agent label under the title (from session.agentName). */
  agentName?: string;
  /** Last-turn status for trailing status dot / running title shimmer. */
  lastTurnStatus?: TurnStatus;
  /** Shown as compact relative time on the right. */
  lastMessageAt?: Date;
  /** Overflow actions (e.g. rename / delete menu) — rendered as a sibling of the title button. */
  actions?: ReactNode;
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

function ThreadListRunningDots() {
  // Same geometry as Lucide `ellipsis` (r=1, centers at 5/12/19 in a 24 viewBox).
  return (
    <svg
      data-slot="aui_thread-list-item-running-dots"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="aui-jumping-dots size-3.5"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

function ThreadListRowHoverTip({ title, age }: { title: string; age?: string }) {
  return (
    <span className="flex w-full min-w-0 items-start gap-3 text-left">
      <span className="min-w-0 flex-1 overflow-y-auto whitespace-normal break-words font-medium text-text-primary">
        {title}
      </span>
      {age != null ? <span className="shrink-0 text-xs text-text-secondary tabular-nums">{age}</span> : null}
    </span>
  );
}

export function ThreadListRow({
  title,
  active,
  onSelect,
  agentName,
  lastTurnStatus,
  lastMessageAt,
  actions,
  className,
}: ThreadListRowProps) {
  const isMobile = useIsMobile();
  const statusDotClass = lastTurnStatusDotClass(lastTurnStatus);
  const statusLabel = lastTurnStatusLabel(lastTurnStatus);
  const running = isRunningTurnStatus(lastTurnStatus);
  const paused = isPausedTurnStatus(lastTurnStatus);
  const age = lastMessageAt != null ? formatRelativeShort(lastMessageAt) : undefined;
  // Paused/error → status dot; running → jumping dots; otherwise relative age.
  const relative = !running && statusDotClass == null ? age : undefined;
  const hasTrailing = running || relative != null || statusDotClass != null || actions != null;

  const row = (
    <div
      data-slot="aui_thread-list-item"
      data-active={active || undefined}
      className={cn(
        'group flex min-w-0 items-center gap-0.5 rounded-[0.5rem] transition-colors',
        active
          ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
          : 'text-text-secondary hover:bg-ghost-button-hover hover:text-text-primary',
        className,
      )}
    >
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-sm font-normal text-text-primary', running && 'aui-text-shimmer')}>
              {title}
            </span>
            {/* Mobile: keep the paused/error dot next to the title when actions own the trailing slot. */}
            {statusDotClass != null && actions != null ? (
              <span data-slot="session-status-dot" className="shrink-0 md:hidden">
                <StatusDot className="size-1.5" colorClassName={statusDotClass} pulse={paused} />
              </span>
            ) : null}
            {statusLabel != null ? <span className="sr-only">{statusLabel}</span> : null}
          </span>
          {agentName != null ? <ThreadListAgentName agentName={agentName} /> : null}
        </span>
      </button>
      {hasTrailing ? (
        <div className="relative mr-1 size-7 shrink-0">
          {statusDotClass != null ? (
            <span
              data-slot="session-status-dot"
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity',
                actions != null &&
                  'hidden md:flex md:opacity-100 md:group-hover:opacity-0 md:group-focus-within:opacity-0 md:group-has-[[data-state=open]]:opacity-0',
              )}
            >
              <StatusDot className="size-1.5" colorClassName={statusDotClass} pulse={paused} />
            </span>
          ) : running ? (
            <span
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center justify-center text-text-primary transition-opacity',
                actions != null &&
                  'opacity-0 md:opacity-100 md:group-hover:opacity-0 md:group-focus-within:opacity-0 md:group-has-[[data-state=open]]:opacity-0',
              )}
            >
              <ThreadListRunningDots />
            </span>
          ) : relative != null ? (
            <span
              data-slot="aui_thread-list-item-age"
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-secondary transition-opacity',
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
                (running || relative != null || statusDotClass != null) &&
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

  // Desktop-only hover tip: full title + age (age still shows when the trailing slot is a status dot).
  return (
    <Tooltip
      side="right"
      interactive={false}
      dismissOnClick
      // Keep closed on mobile so the tip never covers the row on touch.
      {...(isMobile ? { open: false } : {})}
      triggerClassName="block min-w-0 w-full max-w-full"
      className="box-border max-h-24 w-64 max-w-64 overflow-hidden whitespace-normal border border-border p-2.5 shadow-lg"
      content={<ThreadListRowHoverTip title={title} {...(age == null ? {} : { age })} />}
    >
      {row}
    </Tooltip>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ThreadListRow: typeof ThreadListRow;
  }
}
