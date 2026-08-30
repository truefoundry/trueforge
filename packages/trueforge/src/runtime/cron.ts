/**
 * Cron evaluation for schedules.
 *
 * `cron-parser` is used for computation only; it owns no timers. Expressions are
 * evaluated in the schedule's IANA zone. On a spring-forward gap, a time that
 * does not exist (e.g. 02:30) maps onto the landing hour (03:30); fall-back
 * repeats are not double-fired for a fixed hour. Callers that care about the
 * exact UTC instant should prefer `timezone: "UTC"`.
 */
import { CronExpressionParser } from 'cron-parser';
import { InvalidCronError, type ScheduleManifest } from '../schemas/schedule';

/** How many consecutive triggers to sample when measuring the tightest gap. */
const INTERVAL_PROBE_TRIGGERS = 5;

/**
 * Next trigger time strictly after `from`, in `timezone`.
 *
 * Throws {@link InvalidCronError} when the expression parses structurally
 * but cannot produce a trigger time — e.g. `0 0 30 2 *`, February 30th.
 */
export function nextTriggerAfter(input: { cron: string; timezone: string; from: Date }): Date {
  const { cron, timezone, from } = input;
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: from,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch (error) {
    throw new InvalidCronError(`Cron expression "${cron}" has no next trigger time in ${timezone}`, { cause: error });
  }
}

/**
 * Tightest gap the expression can produce, in seconds, measured over the next
 * {@link INTERVAL_PROBE_TRIGGERS} triggers.
 *
 * Sampling rather than analysis: a cron field can be irregular (`0 9,9 * * *`,
 * `*\/7 * * * *`), and DST transitions can make some real gaps shorter than the
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
  for (let i = 0; i < INTERVAL_PROBE_TRIGGERS; i++) {
    const current = interval.next().toDate();
    tightest = Math.min(tightest, (current.getTime() - previous.getTime()) / 1000);
    previous = current;
  }
  return tightest;
}
