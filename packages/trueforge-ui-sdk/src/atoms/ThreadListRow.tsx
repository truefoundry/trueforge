'use client';

import type { ReactNode } from 'react';

import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type ThreadListRowProps = {
  title: string;
  active: boolean;
  onSelect: () => void;
  /** Overflow actions (e.g. delete menu) — rendered as a sibling of the title button. */
  actions?: ReactNode;
  className?: string;
};

export function ThreadListRow({ title, active, onSelect, actions, className }: ThreadListRowProps) {
  return (
    <div
      data-slot="aui_thread-list-item"
      data-active={active || undefined}
      className={cn(
        'group flex min-w-0 items-center gap-0.5 rounded-md transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{ borderRadius: 'var(--thread-list-item-radius, 0.5rem)' }}
        className={auiButtonClass({
          variant: 'ghost',
          className: cn(
            '!justify-start h-8 min-w-0 flex-1 overflow-hidden rounded-md px-2.5 text-left font-normal shadow-none',
            'bg-transparent hover:bg-transparent hover:text-inherit',
            active ? 'text-foreground' : 'text-inherit',
          ),
        })}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {actions != null ? <div className="shrink-0 pr-0.5">{actions}</div> : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ThreadListRow: typeof ThreadListRow;
  }
}
