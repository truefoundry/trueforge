'use client';

import type { SandboxEnvironmentStatus } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { Tooltip } from '../primitives/Tooltip.js';

const STATUS_LABEL: Record<SandboxEnvironmentStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  failed: 'Failed',
};

export function EnvironmentStatusBadge({
  status,
  statusReason,
}: {
  status: SandboxEnvironmentStatus;
  statusReason?: string | null;
}) {
  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium',
        status === 'active' &&
          'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-300',
        status === 'pending' &&
          'border-sky-600/30 bg-sky-500/10 text-sky-800 dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-300',
        status === 'failed' &&
          'border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-300',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );

  if (status === 'failed' && statusReason != null && statusReason.length > 0) {
    return <Tooltip content={statusReason}>{badge}</Tooltip>;
  }
  return badge;
}
