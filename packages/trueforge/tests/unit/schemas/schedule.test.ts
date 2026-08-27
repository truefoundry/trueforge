import { validateManifest } from '../../../src/apis/schedules';
import { CronExpressionSchema, InvalidCronError, TimezoneSchema } from '../../../src/schemas/schedule';

const WEEKDAY_1PM = { cron: '0 13 * * 1-5', timezone: 'America/New_York' };

describe('CronExpressionSchema', () => {
  it('rejects a non-5-field cron', () => {
    expect(CronExpressionSchema.safeParse('0 13 * *').success).toBe(false);
    expect(CronExpressionSchema.safeParse('not a cron').success).toBe(false);
  });

  it('accepts a 5-field cron', () => {
    expect(CronExpressionSchema.safeParse('0 0 * * *').success).toBe(true);
  });
});

describe('TimezoneSchema', () => {
  it('rejects a non-IANA timezone', () => {
    expect(TimezoneSchema.safeParse('UTC+5:30').success).toBe(false);
    expect(TimezoneSchema.safeParse('Not/A_Zone').success).toBe(false);
  });

  it('accepts a valid IANA timezone', () => {
    expect(TimezoneSchema.safeParse('America/New_York').success).toBe(true);
  });
});

describe('validateManifest', () => {
  it('accepts the minimum interval', () => {
    expect(() => {
      validateManifest({ cron: '0 * * * *', timezone: 'UTC' });
    }).not.toThrow();
  });

  it('accepts a daily schedule', () => {
    expect(() => {
      validateManifest(WEEKDAY_1PM);
    }).not.toThrow();
  });

  it('accepts a yearly cron', () => {
    expect(() => {
      validateManifest({ cron: '0 0 1 1 *', timezone: 'UTC' }, new Date('2026-08-27T12:00:00.000Z'));
    }).not.toThrow();
  });

  it('rejects a cron tighter than one hour', () => {
    expect(() => {
      validateManifest({ cron: '*/5 * * * *', timezone: 'UTC' });
    }).toThrow(InvalidCronError);
  });

  it('rejects a back-dated cron with no upcoming trigger time', () => {
    expect(() => {
      validateManifest({ cron: '0 0 30 2 *', timezone: 'UTC' });
    }).toThrow(InvalidCronError);
  });
});
