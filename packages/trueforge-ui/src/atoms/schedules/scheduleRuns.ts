import type { ScheduleRun, ScheduleRunStatus } from '../../server/types.js';

export function isManualRun(name: string): boolean {
  return name.startsWith('manual-');
}

export function runChipKind(status: ScheduleRunStatus): 'success' | 'failed' {
  if (status === 'failed') return 'failed';
  return 'success';
}

export function runStatusLabel(status: ScheduleRunStatus): string {
  if (status === 'failed') return 'Failed';
  if (status === 'triggered') return 'Triggered';
  return 'Scheduled';
}

export function runTypeLabel(name: string): string {
  return isManualRun(name) ? 'Manual test' : 'Cron';
}

/** Newest-first API rows → up to `limit` historical runs, oldest on the left. */
export function lastHistoricalRuns(runs: readonly ScheduleRun[], limit = 5): ScheduleRun[] {
  const historical = runs.filter(run => run.status !== 'scheduled');
  return historical.slice(0, limit).reverse();
}

export function formatScheduleRunInstant(iso: string | null): string {
  if (iso == null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
