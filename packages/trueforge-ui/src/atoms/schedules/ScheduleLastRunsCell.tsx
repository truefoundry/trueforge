'use client';

import type { ScheduleRun } from '../../server/types.js';
import { ScheduleRunChip } from './ScheduleRunChip.js';
import { lastHistoricalRuns } from './scheduleRuns.js';

export function ScheduleLastRunsCell({
  runs,
  onOpenSession,
  sessionHrefForRun,
}: {
  runs: readonly ScheduleRun[];
  onOpenSession?: (run: ScheduleRun) => void;
  sessionHrefForRun?: (run: ScheduleRun) => string | undefined;
}) {
  const history = lastHistoricalRuns(runs);
  if (history.length === 0) {
    return <span className="text-text-secondary text-sm">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {history.map(run => {
        const href = sessionHrefForRun?.(run);
        return (
          <ScheduleRunChip
            key={run.id}
            run={run}
            {...(onOpenSession == null ? {} : { onOpenSession })}
            {...(href == null ? {} : { href })}
          />
        );
      })}
    </div>
  );
}
