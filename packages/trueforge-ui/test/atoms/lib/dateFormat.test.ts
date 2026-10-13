import { describe, expect, it } from 'vitest';

import { formatAbsoluteDateTime, formatRelativeTime } from '@/atoms/lib/dateFormat.js';

describe('formatAbsoluteDateTime', () => {
  it('formats with the shared absolute date+time options', () => {
    const date = new Date('2026-04-05T14:03:02.000Z');
    expect(formatAbsoluteDateTime(date)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date),
    );
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000;

  it('handles null and invalid dates with custom or default fallback', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime(null, { fallback: 'Never' })).toBe('Never');
    expect(formatRelativeTime('invalid-date')).toBe('—');
    expect(formatRelativeTime('invalid-date', { fallback: 'Never' })).toBe('Never');
  });

  it('formats seconds, minutes, hours, and days relative to now', () => {
    expect(formatRelativeTime(new Date(now - 30_000).toISOString(), { nowMs: now })).toBe('just now');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), { nowMs: now })).toBe('5 min ago');
    expect(formatRelativeTime(new Date(now - 60 * 60_000).toISOString(), { nowMs: now })).toBe('1 hour ago');
    expect(formatRelativeTime(new Date(now - 5 * 3600_000).toISOString(), { nowMs: now })).toBe('5 hours ago');
    expect(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString(), { nowMs: now })).toBe('2 days ago');
  });
});
