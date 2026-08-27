/**
 * Cron evaluation for schedules.
 *
 * `cron-parser` is used for computation only; it owns no timers. Matching is
 * literal wall-clock in the schedule's IANA zone, so on a DST transition day a
 * 02:30 schedule does not fire (spring forward) and a 01:30 schedule fires twice
 * (fall back) — both accepted, both derived from the same single code path.
 */
import { CronExpressionParser } from 'cron-parser';
import { InvalidCronError, type ScheduleManifest } from '../schemas/schedule';

/** How many consecutive fires to sample when measuring the tightest gap. */
const INTERVAL_PROBE_FIRES = 5;

/**
 * Next fire strictly after `from`, in the manifest's zone.
 *
 * Throws {@link InvalidCronError} when the expression parses structurally
 * but cannot produce a fire — e.g. `0 0 30 2 *`, February 30th.
 */
export function nextFireAfter(manifest: Pick<ScheduleManifest, 'cron' | 'timezone'>, from: Date): Date {
  try {
    const interval = CronExpressionParser.parse(manifest.cron, {
      currentDate: from,
      tz: manifest.timezone,
    });
    return interval.next().toDate();
  } catch (error) {
    throw new InvalidCronError(
      `Cron expression "${manifest.cron}" has no next fire time in ${manifest.timezone}`,
      { cause: error },
    );
  }
}

/**
 * Tightest gap the expression can produce, in seconds, measured over the next
 * {@link INTERVAL_PROBE_FIRES} fires.
 *
 * Sampling rather than analysis: a cron field can be irregular (`0 9,9 * * *`,
 * `*\/7 * * * *`), and the DST fall-back hour makes some real gaps shorter than the
 * nominal one. Probing the actual sequence is both simpler and more honest than
 * reasoning about the fields.
 */
export function minIntervalSeconds(
  manifest: Pick<ScheduleManifest, 'cron' | 'timezone'>,
  from: Date = new Date(),
): number {
  const interval = CronExpressionParser.parse(manifest.cron, {
    currentDate: from,
    tz: manifest.timezone,
  });

  let previous = interval.next().toDate();
  let tightest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < INTERVAL_PROBE_FIRES; i++) {
    const current = interval.next().toDate();
    tightest = Math.min(tightest, (current.getTime() - previous.getTime()) / 1000);
    previous = current;
  }
  return tightest;
}
