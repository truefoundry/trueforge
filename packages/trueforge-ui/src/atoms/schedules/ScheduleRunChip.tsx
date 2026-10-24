'use client';

import { Icon } from '../../icons/Icon.js';
import type { ScheduleRun } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { formatScheduleRunInstant, runChipKind, runStatusLabel } from './scheduleRuns.js';
import { ScheduleRunTooltip } from './ScheduleRunTooltip.js';

const CHIP_STYLES = {
  success:
    'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-300',
} as const;

export function ScheduleRunChip({
  run,
  onOpenSession,
}: {
  run: ScheduleRun;
  onOpenSession?: (run: ScheduleRun) => void;
}) {
  const kind = runChipKind(run.status);
  const when = formatScheduleRunInstant(run.triggeredAt ?? run.scheduledFor);
  const label = `${runStatusLabel(run.status)} run at ${when}`;
  const chipClass = cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md border', CHIP_STYLES[kind]);
  const icon = <Icon name={kind === 'failed' ? 'triangle-exclamation' : 'check'} className="size-3.5" />;
  return (
    <Tooltip content={<ScheduleRunTooltip run={run} />} className="max-w-sm whitespace-normal" side="top">
      {onOpenSession != null && run.sessionId != null && run.sessionId !== '' ? (
        <button
          type="button"
          className={cn(chipClass, 'cursor-pointer hover:brightness-95')}
          aria-label={`Open session for ${label}`}
          onClick={() => onOpenSession(run)}
        >
          {icon}
        </button>
      ) : (
        <span className={chipClass} aria-label={label}>
          {icon}
        </span>
      )}
    </Tooltip>
  );
}
