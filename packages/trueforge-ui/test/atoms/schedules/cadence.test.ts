import { describe, expect, it } from 'vitest';

import { cronToFormValues, formatCadenceSummary } from '@/atoms/schedules/cadence.js';

describe('formatCadenceSummary', () => {
  it('formats supported hourly, daily, and weekly patterns', () => {
    expect(formatCadenceSummary({ cron: '15 * * * *', timezone: 'UTC' })).toBe('Hourly at :15 UTC');
    expect(formatCadenceSummary({ cron: '30 9 * * *', timezone: 'UTC' })).toBe('Daily 9:30 AM UTC');
    expect(formatCadenceSummary({ cron: '0 14 * * 1-5', timezone: 'UTC' })).toBe('Weekdays 2:00 PM UTC');
  });

  it('keeps custom monthly and yearly expressions verbatim', () => {
    expect(formatCadenceSummary({ cron: '0 9 1 * *', timezone: 'UTC' })).toBe('0 9 1 * *');
    expect(formatCadenceSummary({ cron: '0 9 1 1 *', timezone: 'UTC' })).toBe('0 9 1 1 *');
  });

  it('keeps weekday-constrained hourly expressions custom', () => {
    const cron = '15 * * * 1';
    expect(formatCadenceSummary({ cron, timezone: 'UTC' })).toBe(cron);
    expect(
      cronToFormValues({
        name: 'monday-hourly',
        task: 'run',
        cron,
        timezone: 'UTC',
      }).recurrence,
    ).toBe('custom');
  });
});
