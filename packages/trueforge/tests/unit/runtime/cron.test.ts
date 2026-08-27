import { minIntervalSeconds, nextFireAfter } from '../../../src/runtime/cron';
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

describe('nextFireAfter', () => {
  it('fires at the wall-clock time in the schedule zone, not UTC', () => {
    // 2026-08-27 is a Thursday; EDT is UTC-4, so 13:00 local is 17:00Z.
    const next = nextFireAfter(WEEKDAY_1PM.cron, WEEKDAY_1PM.timezone, new Date('2026-08-27T10:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-08-27T17:00:00.000Z');
  });

  it('skips the weekend for a weekday-only expression', () => {
    // Friday after the fire → next is Monday.
    const next = nextFireAfter(WEEKDAY_1PM.cron, WEEKDAY_1PM.timezone, new Date('2026-08-28T18:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('is strictly after `from`, so a fire cannot land on its own slot', () => {
    const slot = new Date('2026-08-27T17:00:00.000Z');
    expect(nextFireAfter(WEEKDAY_1PM.cron, WEEKDAY_1PM.timezone, slot).getTime()).toBeGreaterThan(slot.getTime());
  });

  it('throws for an expression that can never fire', () => {
    // February 30th.
    expect(() => nextFireAfter('0 0 30 2 *', 'UTC', new Date())).toThrow(InvalidCronError);
  });

  describe('DST — matching is literal wall-clock', () => {
    it('holds the local hour across the autumn transition', () => {
      // 2026-11-01 is the US fall-back date. EDT (UTC-4) before, EST (UTC-5) after,
      // so the same 13:00 local fire moves from 17:00Z to 18:00Z.
      const before = nextFireAfter(WEEKDAY_1PM.cron, WEEKDAY_1PM.timezone, new Date('2026-10-30T00:00:00.000Z'));
      expect(before.toISOString()).toBe('2026-10-30T17:00:00.000Z');

      const after = nextFireAfter(WEEKDAY_1PM.cron, WEEKDAY_1PM.timezone, new Date('2026-11-02T00:00:00.000Z'));
      expect(after.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    });

    it('never fires at a wall-clock time the zone skipped', () => {
      // 2026-03-08 is the US spring-forward date: 02:00–03:00 local never happens
      // in New York, so a 02:30 schedule has no slot that day.
      const next = nextFireAfter('30 2 * * *', NEW_YORK, new Date('2026-03-07T12:00:00.000Z'));
      expect(localWallClock(next)).toBe('02:30');
      expect(localDate(next)).not.toBe('2026-03-08');
    });
  });
});

describe('minIntervalSeconds', () => {
  it('measures an hourly expression as one hour', () => {
    expect(minIntervalSeconds({ cron: '0 * * * *', timezone: 'UTC' }, new Date('2026-08-27T00:00:00.000Z'))).toBe(3600);
  });

  it('reports the tightest gap, not the nominal one', () => {
    // 09:00 and 09:30 daily: mostly ~23.5h apart, but 30 minutes once a day.
    expect(
      minIntervalSeconds({ cron: '0,30 9 * * *', timezone: 'UTC' }, new Date('2026-08-27T00:00:00.000Z')),
    ).toBe(1800);
  });
});
