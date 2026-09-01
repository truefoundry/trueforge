'use client';

import type { ScheduleStatus } from '../../server/types.js';
import { cn } from '../lib/cn.js';

export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const active = status === 'active';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        active
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-text-secondary/15 text-text-secondary',
      )}
    >
      <span className={cn('size-1.5 rounded-full', active ? 'bg-emerald-600' : 'bg-text-secondary')} aria-hidden />
      {active ? 'Active' : 'Paused'}
    </span>
  );
}
