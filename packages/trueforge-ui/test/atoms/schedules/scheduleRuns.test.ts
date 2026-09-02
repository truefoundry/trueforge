import { describe, expect, it } from 'vitest';

import { isManualRun, lastHistoricalRuns, runChipKind, runStatusLabel } from '@/atoms/schedules/scheduleRuns.js';
import type { ScheduleRun } from '@/server/types.js';

const run = (overrides: Partial<ScheduleRun>): ScheduleRun => ({
  id: overrides.id ?? 'run',
  scheduleId: 's1',
  name: overrides.name ?? 'sched-1',
  scheduledFor: overrides.scheduledFor ?? '2024-06-01T10:00:00.000Z',
  status: overrides.status ?? 'triggered',
  triggeredAt: overrides.triggeredAt ?? '2024-06-01T10:00:01.000Z',
  triggeredBy: 'alice',
});

describe('scheduleRuns helpers', () => {
  it('detects manual runs by name prefix', () => {
    expect(isManualRun('manual-abc')).toBe(true);
    expect(isManualRun('sched-123')).toBe(false);
  });

  it('maps chip kinds from run status', () => {
    expect(runChipKind('failed')).toBe('failed');
    expect(runChipKind('triggered')).toBe('success');
    expect(runChipKind('scheduled')).toBe('success');
    expect(runStatusLabel('triggered')).toBe('Triggered');
  });

  it('returns up to five historical runs oldest-first', () => {
    const runs = [
      run({ id: 'newest', scheduledFor: '2024-06-03T10:00:00.000Z' }),
      run({ id: 'middle', scheduledFor: '2024-06-02T10:00:00.000Z' }),
      run({ id: 'oldest', scheduledFor: '2024-06-01T10:00:00.000Z' }),
      run({ id: 'pending', status: 'scheduled', triggeredAt: null, scheduledFor: '2024-12-31T10:00:00.000Z' }),
    ];
    expect(lastHistoricalRuns(runs).map(row => row.id)).toEqual(['oldest', 'middle', 'newest']);
  });
});
