import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  formatSessionTimePresetLabel,
  formatTimezoneOffsetLabel,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from '@/utils/sessionTimePresets.js';

describe('sessionTimePresets', () => {
  it('labels known windows and rejects unknown ones', () => {
    assert.equal(formatSessionTimePresetLabel(30 * 60 * 1000), 'Last 30 minutes');
    assert.equal(formatSessionTimePresetLabel(12 * 60 * 60 * 1000), 'Last 12 hours');
    assert.equal(formatSessionTimePresetLabel(1), null);
  });

  it('formats a timezone offset from a fixed date', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const hours = String(Math.floor(abs / 60)).padStart(2, '0');
    const minutes = String(abs % 60).padStart(2, '0');
    assert.equal(formatTimezoneOffsetLabel(date), `UTC${sign}${hours}:${minutes}`);
  });

  it('round-trips datetime-local values', () => {
    const ts = Date.parse('2026-08-31T12:21:18.000Z');
    const local = toDateTimeLocalValue(ts);
    const parsed = fromDateTimeLocalValue(local);
    assert.ok(parsed != null);
    assert.equal(parsed, ts);
  });
});
