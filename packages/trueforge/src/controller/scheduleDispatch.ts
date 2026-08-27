import type { Logger } from 'winston';
import { cronRunName, type DueScheduleRun, type IScheduleStore, type ScheduleRunRecord } from '../db/scheduleStore';
import type { WithTransaction } from '../db/transaction';
import { nextFireAfter } from '../runtime/cron';
import { InvalidCronError, SCHEDULE_MAX_LATENESS_SECONDS } from '../schemas/schedule';
import type { ControlLoop } from './Controller';

/**
 * Rows examined per pass.
 *
 * TODO(controller): a backlog larger than this is left for the next tick rather
 * than drained in a loop. Fine while the tick is short relative to the minimum
 * interval; revisit if either changes.
 */
export const DISPATCH_BATCH_LIMIT = 20;

/** A run whose stored cron can no longer produce a fire: terminated, not retried. */
const UNFIREABLE = 'unfireable';
/** A run past the lateness bound: terminated without firing. */
const MISSED = 'missed';

function isTooLate(run: ScheduleRunRecord, now: number): boolean {
  return (now - Date.parse(run.scheduled_for)) / 1000 > SCHEDULE_MAX_LATENESS_SECONDS;
}

/**
 * Process one due scheduled run in a transaction: mark it triggered, missed, or
 * unfireable, then arm the next pending slot.
 *
 * Transition the current row before inserting the next pending one
 * (`schedule_run_pending_uq`). Re-read the schedule so a pause is honoured.
 *
 * Returns the triggered run, a terminal marker, or `undefined` when the schedule was
 * paused/deleted before we handled it.
 */
async function processScheduledRun<TTransaction>(
  scheduleStore: IScheduleStore<TTransaction>,
  withTransaction: WithTransaction<TTransaction>,
  run: ScheduleRunRecord,
  now: number,
): Promise<DueScheduleRun | typeof MISSED | typeof UNFIREABLE | undefined> {
  return withTransaction(async transaction => {
    const schedule = await scheduleStore.getSchedule(
      { tenant_id: run.tenant_id, id: run.schedule_id },
      transaction,
    );

    // Pause drops the pending run; delete cascades it. Either way there is nothing
    // to fire. A stale due-query row is left alone for the next pause/resume/edit.
    if (schedule === undefined || schedule.status !== 'active') {
      return undefined;
    }

    const from = new Date(now);
    let nextFire: Date;
    try {
      nextFire = nextFireAfter(schedule.manifest.cron, schedule.manifest.timezone, from);
    } catch (error) {
      if (!(error instanceof InvalidCronError)) {
        throw error;
      }
      // The stored expression can no longer fire — a calendar dead end, or a
      // manifest written before validation covered this case. Terminate the row so
      // it stops coming back as due, and leave the schedule unarmed: it goes silent
      // rather than erroring on every tick forever. The caller logs it; there is no
      // notification channel yet.
      await scheduleStore.finishRun(
        { tenant_id: run.tenant_id, id: run.id, status: 'failed', expected_status: 'scheduled' },
        transaction,
      );
      return UNFIREABLE;
    }

    const nextRun = {
      tenant_id: schedule.tenant_id,
      schedule_id: schedule.id,
      name: cronRunName(nextFire),
      scheduled_for: nextFire,
      status: 'scheduled' as const,
      triggered_by: schedule.created_by,
    };

    if (isTooLate(run, now)) {
      const terminated = await scheduleStore.finishRun(
        { tenant_id: run.tenant_id, id: run.id, status: 'missed', expected_status: 'scheduled' },
        transaction,
      );
      if (terminated === undefined) {
        return undefined;
      }
      await scheduleStore.createRun(nextRun, transaction);
      return MISSED;
    }

    const triggered = await scheduleStore.triggerRun({ tenant_id: run.tenant_id, id: run.id }, transaction);
    if (triggered === undefined) {
      // Pending row was dropped (pause) after the due query.
      return undefined;
    }

    await scheduleStore.createRun(nextRun, transaction);
    return { run: triggered, schedule };
  });
}

/**
 * Schedule dispatch: turn due `scheduled` runs into triggered runs and advance each
 * schedule to its next slot.
 *
 * ## Races with the schedule API
 *
 * Dispatch and the API both write `schedule_run`. Every case below resolves without
 * a lost fire or a duplicated one, because of two rules: the schedule is re-read
 * INSIDE the per-run transaction, and every row transition is guarded on the status
 * it expects to find.
 *
 * - **pause**: drops the pending run in its own transaction. If pause commits first,
 *   `triggerRun` matches nothing and the run is abandoned — correct, pause wins. If
 *   dispatch commits first, the run fires and pause deletes the row dispatch just
 *   armed, so firing stops from the next tick. A pause that lands mid-flight
 *   cannot stop a run already handed to the executor.
 * - **resume / put**: both delete the pending run and insert a fresh one. Racing
 *   dispatch, one of the two transactions blocks on the other's row lock, then
 *   re-evaluates against the committed result. Whoever loses the race to insert 
 *   the next pending row fails on `schedule_run_pending_uq` and rolls
 *   back — no schedule ends up with two pending runs or none.
 * - **delete**: cascades the runs away. Dispatch either sees the schedule gone
 *   (`getSchedule` → undefined, abandon) or holds the row and delete waits. A run
 *   already handed to the executor keeps going and leaves an orphan session; the run
 *   row is gone, which is accepted.
 * - **cron expression change**: the next run is computed from the
 *   manifest read inside this transaction, so it is never a mix of old and new. A
 *   put that commits after this read leaves one run on the old expression; the
 *   following run is scheduled correctly.
 *
 * The bottom of this file wires the same logic to a {@link ControlLoop}: the loop
 * owns cadence and log volume, everything above owns the decisions.
 *
 * ## Concurrency
 *
 * NOT concurrency safe by design: call this from exactly ONE process. There is no
 * row claim, so two dispatchers would both scan and both attempt every row. They
 * would not double-fire — the guarded `scheduled -> triggered` transition means one
 * wins and the other abandons — but they would waste transactions and log noise on
 * every tick.
 */
export async function dispatchDueRuns<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  /** Fire-and-forget: must not hold the dispatch pass open. */
  onTriggered: (item: DueScheduleRun) => void;
  logger: Logger;
  limit?: number | undefined;
}): Promise<{ dispatched: number; missed: number; unfireable: number }> {
  const { scheduleStore, withTransaction, onTriggered, logger } = params;
  const limit = params.limit ?? DISPATCH_BATCH_LIMIT;
  const scheduled = await scheduleStore.findScheduledRuns({ limit });
  const now = Date.now();

  let dispatched = 0;
  let missed = 0;
  let unfireable = 0;

  for (const run of scheduled) {
    try {
      const outcome = await processScheduledRun(scheduleStore, withTransaction, run, now);
      if (outcome === undefined) {
        continue;
      }
      if (outcome === MISSED) {
        logger.warn('Schedule run missed its slot', {
          schedule_id: run.schedule_id,
          run_id: run.id,
          scheduled_for: run.scheduled_for,
        });
        missed += 1;
        continue;
      }
      if (outcome === UNFIREABLE) {
        logger.error('Schedule has no next fire time; it will not run again until edited', {
          schedule_id: run.schedule_id,
          run_id: run.id,
        });
        unfireable += 1;
        continue;
      }
      // Hand off as soon as this run's own transaction has committed, so the first
      // run starts without waiting on the rest of the batch. The hand-off is
      // isolated: the row is already `triggered`, so a throwing executor must not
      // stop the remaining runs from being processed.
      try {
        onTriggered(outcome);
        dispatched += 1;
      } catch (error) {
        logger.error('Failed to hand off triggered run', {
          schedule_id: outcome.schedule.id,
          run_id: outcome.run.id,
          error,
        });
      }
    } catch (error) {
      logger.error('Failed to process scheduled run', {
        schedule_id: run.schedule_id,
        run_id: run.id,
        error,
      });
    }
  }

  return { dispatched, missed, unfireable };
}

export const SCHEDULE_DISPATCH_LOOP_NAME = 'schedule-dispatch';

/**
 * Gap between passes.
 *
 * Well below the minimum schedule interval, so a slot is picked up within a tick of
 * becoming due, and cheap: an idle pass is one indexed query against
 * `schedule_run_due_idx`.
 */
export const SCHEDULE_DISPATCH_INTERVAL_MS = 60_000;

/**
 * Stand-in until the run executor lands: records the hand-off and drops it.
 *
 * A run reaching here is already `triggered` in the database, so it will sit in that
 * status forever — which is the honest state of the feature until an executor exists.
 *
 * TODO(executor): replace with the real executor. Note it runs in the controller's
 * process, so the dedicated deployment will need everything a turn needs — model
 * provider credentials, MCP egress, sandbox access — not just database reach.
 */
export function logTriggeredRun(logger: Logger): (item: DueScheduleRun) => void {
  return item => {
    logger.warn('Schedule run triggered but no executor is configured; run will not execute', {
      schedule_id: item.schedule.id,
      run_id: item.run.id,
      agent_id: item.schedule.agent_id,
      scheduled_for: item.run.scheduled_for,
    });
  };
}

export function createScheduleDispatchLoop<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  onTriggered: (item: DueScheduleRun) => void;
  logger: Logger;
}): ControlLoop {
  const { scheduleStore, withTransaction, onTriggered, logger } = params;
  return {
    name: SCHEDULE_DISPATCH_LOOP_NAME,
    intervalMs: SCHEDULE_DISPATCH_INTERVAL_MS,
    async tick(): Promise<void> {
      const result = await dispatchDueRuns({ scheduleStore, withTransaction, onTriggered, logger });
      // Only speak up when something happened; an idle pass every 30s is noise.
      if (result.dispatched > 0 || result.missed > 0 || result.unfireable > 0) {
        logger.info('Schedule dispatch pass', result);
      }
    },
  };
}
