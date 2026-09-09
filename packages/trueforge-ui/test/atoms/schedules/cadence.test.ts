import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cronToFormValues,
  defaultScheduleFormValues,
  formatCadenceSummary,
  getTimezoneOptions,
} from '@/atoms/schedules/cadence.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('schedule timezone defaults', () => {
  it('defaults to the browser timezone and offers an unlisted local zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Pacific/Auckland',
    });

    expect(defaultScheduleFormValues().timezone).toBe('Pacific/Auckland');
    expect(getTimezoneOptions()).toContainEqual({
      value: 'Pacific/Auckland',
      label: 'Pacific/Auckland (Local)',
    });
  });

  it('falls back to UTC when browser timezone detection fails', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('timezone unavailable');
    });

    expect(defaultScheduleFormValues().timezone).toBe('UTC');
  });
});

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
