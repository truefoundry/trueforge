'use client';

import type { ScheduleRun } from '../../server/types.js';
import { formatScheduleRunInstant, runStatusLabel, runTypeLabel } from './scheduleRuns.js';

export function ScheduleRunTooltip({ run }: { run: ScheduleRun }) {
  return (
    <div className="flex flex-col gap-1 text-left text-xs">
      <p className="text-text-primary font-medium">{runStatusLabel(run.status)}</p>
      <p className="text-text-secondary">{runTypeLabel(run.name)}</p>
      <p className="text-text-secondary">Scheduled for: {formatScheduleRunInstant(run.scheduledFor)}</p>
      {run.triggeredAt != null ? (
        <p className="text-text-secondary">Triggered at: {formatScheduleRunInstant(run.triggeredAt)}</p>
      ) : null}
      <p className="text-text-secondary">Triggered by: {run.triggeredBy}</p>
    </div>
  );
}
