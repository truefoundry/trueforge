import type { SessionHandle, Sessions, TurnInputItem } from '@truefoundry/trueforge-core/agent-session';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import type { IAgentStore } from '../db/agentStore';
import {
  cronRunName,
  type IScheduleStore,
  type ScheduleDispatchItem,
  type ScheduleRunRecord,
} from '../db/scheduleStore';
import type { WithTransaction } from '../db/transaction';
import { nextTriggerAfter } from '../runtime/cron';
import { InvalidCronError, type ScheduleRunStatus } from '../schemas/schedule';
import type { ControlLoop } from './Controller';

/**
 * Rows examined per pass.
 *
 * TODO(controller): a backlog larger than this is left for the next tick rather
 * than drained in a loop. Fine while the tick is short relative to the minimum
 * interval; revisit if either changes.
 */
export const DISPATCH_BATCH_LIMIT = 20;

/**
 * Gap between loop passes.
 *
 * Well below the minimum schedule interval, so a run is picked up within a tick of
 * `scheduled_for` passing, and cheap: an idle pass is one indexed query against
 * `schedule_run_scheduled_for_idx`.
 */
const SCHEDULE_DISPATCH_INTERVAL_MS = 60_000;

/** The loop's name. */
const SCHEDULE_DISPATCH_LOOP_NAME = 'schedule-dispatch';

type ScheduleRunApiClient = Pick<TrueForge, 'sessions' | 'internal'>;

/** Schedule's bound agent name is missing from the agent store. */
export class ScheduleAgentNotFoundError extends Error {
  readonly agent_name: string;

  constructor(agent_name: string, options?: ErrorOptions) {
    super(`Agent not found: ${agent_name}`, options);
    this.name = 'ScheduleAgentNotFoundError';
    this.agent_name = agent_name;
  }
}

/**
 * Hands a due schedule run to the API:
 * 1. Get or create a session keyed by `run.id`.
 * 2. Create a non-streaming turn only when that session has no turns.
 *
 * This call is hence idempotent.
 */
function executeScheduledRun(client: ScheduleRunApiClient): (item: ScheduleDispatchItem) => Promise<void> {
  return async ({ run, schedule }) => {
    const { data: session } = await client.internal.sessions.getOrCreateByExternalId({
      externalId: run.id,
      agent: { name: schedule.agent_name },
    });

    const turns = await client.sessions.listTurns(session.id, { limit: 1 });
    if (turns.data.length > 0) {
      return;
    }

    await client.sessions.createTurn(session.id, {
      input: [{ type: 'user.message', content: schedule.manifest.task }],
      previousTurnId: 'none',
    });
  };
}

/**
 * Start a schedule run in-process: get-or-create a session keyed by `run.id`,
 * then create a non-streaming turn with the schedule task when that session has
 * none. Idempotent on retry. Session owner and turn `userRef` are the schedule
 * creator so ownership stays with the schedule even when an admin triggers run-now.
 */
export async function startScheduleRun(params: {
  item: ScheduleDispatchItem;
  sessions: Sessions;
  agentStore: IAgentStore;
  startTurn: (params: {
    session: SessionHandle;
    input: TurnInputItem[];
    previous_turn_id: string;
    userRef: string;
  }) => Promise<void>;
}): Promise<void> {
  const {
    item: { run, schedule },
    sessions,
    agentStore,
    startTurn,
  } = params;

  const named = await agentStore.getAgent({ tenant_id: schedule.tenant_id, name: schedule.agent_name });
  if (named === undefined) {
    throw new ScheduleAgentNotFoundError(schedule.agent_name);
  }

  const { session } = await sessions.getOrCreateByExternalId({
    tenant_id: schedule.tenant_id,
    external_id: run.id,
    created_by: schedule.created_by,
    agent: { type: 'reference', id: named.id, name: named.name },
  });

  // idempotency check
  const { data: turns } = await session.listTurns({ limit: 1 });
  if (turns.length > 0) {
    return;
  }

  await startTurn({
    session,
    input: [{ type: 'user.message', content: schedule.manifest.task }],
    previous_turn_id: 'none',
    userRef: schedule.created_by,
  });
}

/**
 * Mark the current run with `status`, then add the schedule's next scheduled run
 * if the schedule is still active and its cron still has a later trigger time.
 *
 * ## LOCK ORDERING
 * The schedule row is locked FIRST, before the run row is touched. `updateScheduleAndRun`
 * (the PUT path) does the same: it locks the schedule, then deletes and inserts runs.
 * Both transactions therefore take schedule-then-run, and serialize cleanly.
 *
 */
async function finishScheduledRun<TTransaction>(params: {
  store: IScheduleStore<TTransaction>;
  run: ScheduleRunRecord;
  now: Date;
  status: ScheduleRunStatus;
  withTransaction: WithTransaction<TTransaction>;
}): Promise<void> {
  const { store, withTransaction, run, status, now } = params;
  await withTransaction(async txn => {
    const latest = await store.getScheduleForUpdate({ tenant_id: run.tenant_id, id: run.schedule_id }, txn);

    const updated = await store.updateRunStatus({ tenant_id: run.tenant_id, id: run.id, status }, txn);
    if (updated === undefined) {
      return;
    }

    if (latest?.status !== 'active') {
      return;
    }

    // `now` selected this run (`scheduled_for <= now`), so anchoring here gives a
    // trigger time strictly later than the run being finished.
    const advanceFrom = new Date(Math.max(Date.parse(run.scheduled_for), now.getTime()));

    let nextTrigger: Date;
    try {
      nextTrigger = nextTriggerAfter({
        cron: latest.manifest.cron,
        timezone: latest.manifest.timezone,
        from: advanceFrom,
      });
    } catch (error) {
      if (!(error instanceof InvalidCronError)) {
        throw error;
      }
      // No later trigger time (calendar dead end). Ideally should not happen.
      // Still finish the current row; just do not add another.
      return;
    }

    await store.createRun(
      {
        tenant_id: latest.tenant_id,
        schedule_id: latest.id,
        name: cronRunName(nextTrigger),
        scheduled_for: nextTrigger,
        status: 'scheduled',
        triggered_by: latest.created_by,
      },
      txn,
    );
  });
}

/**
 * Schedule dispatch: turn `scheduled` runs with `scheduled_for <= now` into
 * triggered runs and add each schedule's next scheduled run.
 *
 * ## IDEMPOTENCY
 * If the process dies between steps, the same scheduled run is seen again on
 * the next tick — so `onTriggered` should ideally be idempotent (or otherwise safe to
 * call more than once).
 *
 * ## RACE conditions with the schedule API
 *
 * Dispatch and the API both write `schedule_run`. Cases below can drop a pending
 * run or leave an orphan session; that is accepted where noted. Two rules keep
 * pending rows from doubling: the schedule is re-read INSIDE the finish
 * transaction, and `schedule_run_pending_uq` index rejects a second `scheduled` row.
 *
 * - **pause**: drops the pending run in its own transaction, and stops the advance.
 *   It never cancels a row that still exists: whatever pause did not delete is
 *   executed (and recorded `triggered` or `failed`) so history has no unexplained gap.
 *   If pause commits first, the row is gone and there is nothing to run.
 *   If dispatch commits first, the run triggers and pause deletes the pending row
 *   dispatch just added, so triggering stops from the next tick — at most one extra run.
 * - **resume **: no race condition; resume just adds a run.
 * - **cron expression change**: deletes the pending run and inserts a fresh one from the new cron.
 *   If put commits first, the pending run is replaced; finish does not insert again.
 *   Missing triggered history for that run is accepted.
 *   If dispatch commits first, the run triggers and put deletes the pending row dispatch just added,
 *   then inserts a fresh one. So the run that already handed off is kept; the next pending is put's.
 * - **delete**: cascades the runs away. Dispatch either sees the schedule gone
 *   or holds the row and delete waits. A run already handed to the executor keeps going
 *   and leaves an orphan session; the run row is gone, which is accepted.
 *
 * ## CONCURRENCY
 * NOT concurrency safe by design: call this from exactly ONE process.
 */
export async function dispatchScheduledRuns<TTransaction>(params: {
  store: IScheduleStore<TTransaction>;
  onTriggered: (item: ScheduleDispatchItem) => void | Promise<void>;
  logger: Logger;
  withTransaction: WithTransaction<TTransaction>;
  /** When aborted, stop before the next run; the current run still finishes. */
  signal?: AbortSignal;
}): Promise<{ dispatched: number; failed: number }> {
  const { store, withTransaction, onTriggered, logger, signal } = params;
  // ONE clock for the whole pass: it selects the runs, judges lateness, and anchors
  // the next trigger time.
  const now = new Date();
  const scheduled = await store.listScheduledRuns({ limit: DISPATCH_BATCH_LIMIT, until: now });

  let dispatched = 0;
  let failed = 0;
  for (const run of scheduled) {
    if (signal?.aborted) {
      break;
    }
    try {
      const schedule = await store.getSchedule({
        tenant_id: run.tenant_id,
        id: run.schedule_id,
      });
      // Only a deleted schedule stops a row here. `paused` deliberately does NOT:
      // status decides whether the schedule gains a NEW row, never whether an
      // existing one runs. A row that exists was added while the schedule was
      // active, so it is honoured.
      if (schedule === undefined) {
        continue;
      }

      try {
        await onTriggered({ run, schedule });
      } catch (error) {
        logger.error('Failed to hand off triggered run', {
          schedule_id: schedule.id,
          run_id: run.id,
          error,
        });
        await finishScheduledRun({
          store,
          run,
          now,
          status: 'failed',
          withTransaction,
        });
        failed += 1;
        continue;
      }

      await finishScheduledRun({
        store,
        run,
        now,
        status: 'triggered',
        withTransaction,
      });
      dispatched += 1;
    } catch (error) {
      logger.error('Failed to process scheduled run', {
        schedule_id: run.schedule_id,
        run_id: run.id,
        error,
      });
    }
  }

  return { dispatched, failed };
}

export function scheduleDispatchLoop<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  client: ScheduleRunApiClient;
  logger: Logger;
  withTransaction: WithTransaction<TTransaction>;
}): ControlLoop {
  const { scheduleStore, client, withTransaction, logger } = params;
  return {
    name: SCHEDULE_DISPATCH_LOOP_NAME,
    intervalMs: SCHEDULE_DISPATCH_INTERVAL_MS,
    async tick(signal: AbortSignal): Promise<void> {
      const result = await dispatchScheduledRuns({
        store: scheduleStore,
        onTriggered: executeScheduledRun(client),
        logger,
        withTransaction,
        signal,
      });
      if (result.dispatched > 0 || result.failed > 0) {
        logger.debug('Scheduled runs dispatched or failed', result);
      }
    },
  };
}
