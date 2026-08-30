import { minIntervalSeconds, nextTriggerAfter } from '../../../src/runtime/cron';
import { InvalidCronError } from '../../../src/schemas/schedule';

const NEW_YORK = 'America/New_York';

/** 13:00 New York on weekdays — the canonical "daily briefing" schedule. */
const WEEKDAY_1PM = { cron: '0 13 * * 1-5', timezone: NEW_YORK };

/** `HH:mm` of an instant as seen in New York. */
function localWallClock(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NEW_YORK,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/** `YYYY-MM-DD` of an instant as seen in New York. */
function localDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NEW_YORK, dateStyle: 'short' }).format(instant);
}

describe('nextTriggerAfter', () => {
  it('triggers at the wall-clock time in the schedule zone, not UTC', () => {
    // 2026-08-27 is a Thursday; EDT is UTC-4, so 13:00 local is 17:00Z.
    const next = nextTriggerAfter({
      ...WEEKDAY_1PM,
      from: new Date('2026-08-27T10:00:00.000Z'),
    });
    expect(next.toISOString()).toBe('2026-08-27T17:00:00.000Z');
  });

  it('skips the weekend for a weekday-only expression', () => {
    // Friday after the trigger → next is Monday.
    const next = nextTriggerAfter({
      ...WEEKDAY_1PM,
      from: new Date('2026-08-28T18:00:00.000Z'),
    });
    expect(next.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('is strictly after `from`, so a trigger cannot land on the instant it ran', () => {
    const triggeredAt = new Date('2026-08-27T17:00:00.000Z');
    expect(nextTriggerAfter({ ...WEEKDAY_1PM, from: triggeredAt }).getTime()).toBeGreaterThan(triggeredAt.getTime());
  });

  it('throws for an expression that can never trigger', () => {
    // February 30th.
    expect(() => nextTriggerAfter({ cron: '0 0 30 2 *', timezone: 'UTC', from: new Date() })).toThrow(InvalidCronError);
  });

  describe('DST', () => {
    it('holds the local hour across the autumn transition', () => {
      // 2026-11-01 is the US fall-back date. EDT (UTC-4) before, EST (UTC-5) after,
      // so the same 13:00 local trigger moves from 17:00Z to 18:00Z.
      const before = nextTriggerAfter({
        ...WEEKDAY_1PM,
        from: new Date('2026-10-30T00:00:00.000Z'),
      });
      expect(before.toISOString()).toBe('2026-10-30T17:00:00.000Z');

      const after = nextTriggerAfter({
        ...WEEKDAY_1PM,
        from: new Date('2026-11-02T00:00:00.000Z'),
      });
      expect(after.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    });

    it('maps a skipped spring-forward hour onto the landing hour', () => {
      // 2026-03-08 springs forward: 02:00–03:00 never exists in New York.
      // cron-parser fires at 03:30 that day rather than skipping.
      const next = nextTriggerAfter({
        cron: '30 2 * * *',
        timezone: NEW_YORK,
        from: new Date('2026-03-07T12:00:00.000Z'),
      });
      expect(localWallClock(next)).toBe('03:30');
      expect(localDate(next)).toBe('2026-03-08');
    });
  });
});

describe('minIntervalSeconds', () => {
  it('measures an hourly expression as one hour', () => {
    expect(minIntervalSeconds({ cron: '0 * * * *', timezone: 'UTC' }, new Date('2026-08-27T00:00:00.000Z'))).toBe(3600);
  });

  it('reports the tightest gap, not the nominal one', () => {
    // 09:00 and 09:30 daily: mostly ~23.5h apart, but 30 minutes once a day.
    expect(minIntervalSeconds({ cron: '0,30 9 * * *', timezone: 'UTC' }, new Date('2026-08-27T00:00:00.000Z'))).toBe(
      1800,
    );
  });
});
