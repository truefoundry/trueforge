import { describe, expect, it } from 'vitest';

import { formatAbsoluteDateTime } from '@/atoms/lib/dateFormat.js';

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
