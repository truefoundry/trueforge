'use client';

import type { ScheduleStatus } from '../../server/types.js';
import { cn } from '../lib/cn.js';

export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const active = status === 'active';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        active
          ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'border-border bg-secondary-bg text-text-secondary',
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          active ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-text-secondary',
        )}
        aria-hidden
      />
      {active ? 'Active' : 'Paused'}
    </span>
  );
}
