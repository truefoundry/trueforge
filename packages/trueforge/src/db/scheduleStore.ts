/**
 * DB-backed schedules and their runs: one `schedule` row per cron binding, plus a
 * `schedule_run` row per run (pending or historical).
 *
 * One store covers both tables because they are never used apart — the dispatch
 * path needs a scheduled run and its schedule in the same query, and every schedule
 * mutation touches the pending run in the same transaction.
 *
 * Transactions are route-owned (see `WithTransaction`): a store method never opens
 * one. Create/resume/manifest-edit must pass the same transaction to the schedule
 * write and the run write, or a schedule can end up active with no pending run —
 * the silent-dead-schedule failure mode.
 *
 * Implementations: PostgresScheduleStore and SqliteScheduleStore.
 */
import { ScheduleManifestSchema, type ScheduleManifest, type ScheduleStatus } from '../schemas/schedule';

/**
 * Run lifecycle.
 * - `scheduled`  the one pending run; at most one per schedule, enforced by
 *                `schedule_run_pending_uq`
 * - `triggered`  taken by dispatch via `updateRunStatus`
 * - `failed`     errored, or hand-off to the executor failed
 */
export type ScheduleRunStatus = 'scheduled' | 'triggered' | 'failed';

/**
 * `sched-<unixSeconds>` or `manual-<token>` — one name per trigger time, which is what makes
 * `schedule_run_name_idx` reject a duplicated trigger.
 */
export function cronRunName(scheduledFor: Date): string {
  return `sched-${String(Math.floor(scheduledFor.getTime() / 1000))}`;
}

export interface ScheduleRecord {
  id: string;
  tenant_id: string;
  /** Immutable FK to `agent.name` (with tenant); agent version resolves at run time. */
  agent_name: string;
  /** Display label; not unique. */
  name: string;
  manifest: ScheduleManifest;
  status: ScheduleStatus;
  /** userRef every run of this schedule executes as. */
  created_by: string;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ScheduleRunRecord {
  id: string;
  tenant_id: string;
  schedule_id: string;
  name: string;
  /** ISO-8601 UTC instant this run was scheduled for. Preserved even when `missed`. */
  scheduled_for: string;
  status: ScheduleRunStatus;
  /** userRef the run executes as. */
  triggered_by: string;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Schedule row plus the pending run after a create/update that syncs it. */
export interface ScheduleWriteResult {
  schedule: ScheduleRecord;
  /** Set when the schedule is active; otherwise undefined (paused adds no pending run). */
  pendingRun: ScheduleRunRecord | undefined;
}

/** A scheduled run plus the schedule that owns it. */
export interface ScheduleDispatchItem {
  run: ScheduleRunRecord;
  schedule: ScheduleRecord;
}

/**
 * Re-parse persisted manifest JSON so schema defaults materialize. Rows written
 * before a manifest field existed omit it on disk; readers must not assume presence.
 */
export function parseStoredScheduleManifest(manifest: unknown): ScheduleManifest {
  return ScheduleManifestSchema.parse(manifest);
}

export interface ListSchedulesInput {
  tenant_id: string;
  /** When set, only schedules bound to this agent name are returned. */
  agent_name?: string | undefined;
}

export interface GetScheduleInput {
  tenant_id: string;
  id: string;
  /** Whether to take a row lock on the schedule (`SELECT ... FOR UPDATE`). */
  forUpdate: boolean | undefined;
}

export interface CreateScheduleInput {
  tenant_id: string;
  agent_name: string;
  name: string;
  manifest: ScheduleManifest;
  created_by: string;
  /** Instant used to compute the first pending run when status is active. */
  runFrom: Date;
}

/** Replaces `name` + `manifest` for an existing schedule keyed by immutable id. */
export interface UpdateScheduleInput {
  tenant_id: string;
  id: string;
  name: string;
  manifest: ScheduleManifest;
  /**
   * Instant used to compute the next pending run when a sync runs (status/cron/timezone
   * change) and the schedule is active.
   */
  runFrom: Date;
}
export interface DeleteScheduleInput {
  tenant_id: string;
  id: string;
}

export interface CreateScheduleRunInput {
  tenant_id: string;
  schedule_id: string;
  name: string;
  scheduled_for: Date;
  triggered_by: string;
  status: ScheduleRunStatus;
}

export interface ListScheduledRunsInput {
  until: Date;
  limit: number;
}

export interface GetRunInput {
  tenant_id: string;
  /** Immutable run id. */
  id: string;
}

export interface GetScheduledRunForInput {
  tenant_id: string;
  schedule_id: string;
}

export interface UpdateScheduleRunStatusInput {
  tenant_id: string;
  id: string;
  status: ScheduleRunStatus;
}

export class ScheduleRunConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScheduleRunConflictError';
  }
}

/**
 * Pending run is replaced only when `status`, `cron`, or `timezone` change.
 * `name` and `task` edits leave the pending row alone.
 */
export function shouldSyncPendingRun(
  previous: Pick<ScheduleRecord, 'status' | 'manifest'>,
  next: Pick<ScheduleRecord, 'status' | 'manifest'>,
): boolean {
  return (
    previous.status !== next.status ||
    previous.manifest.cron !== next.manifest.cron ||
    previous.manifest.timezone !== next.manifest.timezone
  );
}

export interface IScheduleStore<TTransaction = never> {
  // --- schedule ---
  getSchedule(input: GetScheduleInput, transaction?: TTransaction): Promise<ScheduleRecord | undefined>;
  /**
   * Inserts a schedule (`status` mirrors `manifest.status`) and syncs the pending run
   * in the same call: active adds the next run from `runFrom`; paused adds nothing.
   */
  createScheduleAndRun(input: CreateScheduleInput, transaction?: TTransaction): Promise<ScheduleWriteResult>;
  /**
   * Updates a schedule, then syncs the pending run only when `status`, `cron`, or
   * `timezone` change. `name` / `task` edits leave the pending row alone.
   * Returns undefined if the schedule is gone.
   */
  updateScheduleAndRun(
    input: UpdateScheduleInput,
    transaction?: TTransaction,
  ): Promise<ScheduleWriteResult | undefined>;
  /** Deletes by immutable id; runs cascade. Idempotent if already missing. */
  deleteSchedule(input: DeleteScheduleInput, transaction?: TTransaction): Promise<void>;
  listSchedules(input: ListSchedulesInput, transaction?: TTransaction): Promise<ScheduleRecord[]>;

  // --- schedule_run ---
  /** One run by immutable id. */
  getRun(input: GetRunInput, transaction?: TTransaction): Promise<ScheduleRunRecord | undefined>;
  /** A schedule's single pending (`scheduled`) run, if it has one. */
  getScheduledRunFor(
    input: GetScheduledRunForInput,
    transaction?: TTransaction,
  ): Promise<ScheduleRunRecord | undefined>;
  /** Inserts a run. Throws {@link ScheduleRunConflictError} on either unique index. */
  createRun(input: CreateScheduleRunInput, transaction?: TTransaction): Promise<ScheduleRunRecord>;
  /**
   * Status transition. Stamps `triggered_at` when moving to `triggered`.
   * Returns undefined when the row is gone (e.g. pause deleted it).
   */
  updateRunStatus(
    input: UpdateScheduleRunStatusInput,
    transaction?: TTransaction,
  ): Promise<ScheduleRunRecord | undefined>;
  /**
   * `scheduled` runs with `scheduled_for <= now`, oldest first.
   * Triggered / terminal rows are never returned.
   */
  listScheduledRuns(input: ListScheduledRunsInput, transaction?: TTransaction): Promise<ScheduleRunRecord[]>;
}
