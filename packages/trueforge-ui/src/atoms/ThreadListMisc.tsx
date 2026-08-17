import type { ComponentProps, ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { Skeleton } from './primitives/Skeleton.js';

export type ThreadListNewButtonProps = ComponentProps<'button'>;

export function ThreadListNewButton({ className, children, style, ...rest }: ThreadListNewButtonProps) {
  return (
    <button
      type="button"
      aria-label="Start new chat"
      style={{ borderRadius: 'var(--thread-list-item-radius, 0.5rem)', ...style }}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          '!justify-start h-8 px-2.5 text-sm font-medium text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text',
          className,
        ),
      })}
      {...rest}
    >
      {children ?? (
        <>
          <Icon name="square-pen" />
          New Chat
        </>
      )}
    </button>
  );
}

export type ThreadListRowSkeletonProps = {
  count?: number;
  className?: string;
};

export function ThreadListRowSkeleton({ count = 5, className }: ThreadListRowSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)} role="status" aria-label="Loading threads">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-8 items-center px-2.5">
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
}

export type ThreadListEmptyStateProps = {
  message?: string;
  className?: string;
};

export function ThreadListEmptyState({ message = 'No threads yet', className }: ThreadListEmptyStateProps) {
  return (
    <div
      className={cn('text-text-secondary flex flex-1 items-center justify-center px-4 text-center text-sm', className)}
    >
      {message}
    </div>
  );
}

export type ThreadListShellProps = {
  header: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ThreadListShell({ header, children, className }: ThreadListShellProps) {
  return (
    <div className={cn('font-sans-flex flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="shrink-0 border-b border-border px-2 py-2">{header}</div>
      {/* History section owns overflow scroll so infinite-load IO can root on it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">{children}</div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ThreadListNewButton: typeof ThreadListNewButton;
    ThreadListRowSkeleton: typeof ThreadListRowSkeleton;
    ThreadListEmptyState: typeof ThreadListEmptyState;
    ThreadListShell: typeof ThreadListShell;
  }
}
