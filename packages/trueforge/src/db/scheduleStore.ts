/**
 * DB-backed schedules and their runs: one `schedule` row per cron binding, plus a
 * `schedule_run` row per fire (pending or historical).
 *
 * One store covers both tables because they are never used apart — the dispatch
 * path needs a due run and its schedule in the same query, and every schedule
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
 * - `triggered`  taken by the guarded `scheduled -> triggered` transition
 * - `failed`     turn errored, or terminated waiting on a tool approval nobody
 *                could answer
 * - `missed`     run was later than `SCHEDULE_MAX_LATENESS_SECONDS`;
 *                `scheduled_for` is preserved so history shows the gap honestly
 */
export type ScheduleRunStatus = 'scheduled' | 'triggered' | 'failed' | 'missed';

/**
 * `sched-<unixSeconds>` or `manual-<token>` — one name per cron slot, which is what makes
 * `schedule_run_name_idx` reject a duplicated fire. 
 */
export function cronRunName(scheduledFor: Date): string {
  return `sched-${String(Math.floor(scheduledFor.getTime() / 1000))}`;
}

export interface ScheduleRecord {
  id: string;
  tenant_id: string;
  /** Immutable FK to `agent.id`; the agent's version resolves at run time. */
  agent_id: string;
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
  /** ISO-8601 UTC instant this run was due. Preserved even when `missed`. */
  scheduled_for: string;
  status: ScheduleRunStatus;
  /** userRef the run executes as. */
  triggered_by: string;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A due run plus the schedule that owns it — one query, no N+1 on the dispatch path. */
export interface DueScheduleRun {
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
  /** When set, only schedules bound to this agent are returned. */
  agent_id?: string | undefined;
}

export interface GetScheduleInput {
  tenant_id: string;
  id: string;
}

export interface CreateScheduleInput {
  tenant_id: string;
  agent_id: string;
  name: string;
  manifest: ScheduleManifest;
  created_by: string;
}

/** Replaces `name` + `manifest` for an existing schedule keyed by immutable id. */
export interface UpdateScheduleInput {
  tenant_id: string;
  id: string;
  name: string;
  manifest: ScheduleManifest;
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

export interface FindScheduledRunsInput {
  /** Hard cap on rows returned; the caller drains by calling again. */
  limit: number;
}

export interface TriggerScheduleRunInput {
  tenant_id: string;
  id: string;
}

export interface FinishScheduleRunInput {
  tenant_id: string;
  id: string;
  status: ScheduleRunStatus;
  /**
   * When set, the write only applies if the row is still in this status.
   *
   * Dispatch passes `'scheduled'` when marking a run `missed` so a pause that
   * already dropped the row is a no-op. The executor writing its own outcome
   * needs no guard: it owns the run.
   */
  expected_status?: ScheduleRunStatus | undefined;
}

export interface IScheduleStore<TTransaction = never> {
  listSchedules(input: ListSchedulesInput, transaction?: TTransaction): Promise<ScheduleRecord[]>;
  getSchedule(input: GetScheduleInput, transaction?: TTransaction): Promise<ScheduleRecord | undefined>;
  /** Inserts a schedule with a generated ULID; `status` mirrors `manifest.status`. */
  createSchedule(input: CreateScheduleInput, transaction?: TTransaction): Promise<ScheduleRecord>;
  /**
   * Replaces `name` + `manifest`, and the `status` column with it. Returns undefined
   * if the schedule is gone.
   */
  updateSchedule(input: UpdateScheduleInput, transaction?: TTransaction): Promise<ScheduleRecord | undefined>;
  /** Deletes by immutable id; runs cascade. Idempotent if already missing. */
  deleteSchedule(input: DeleteScheduleInput, transaction?: TTransaction): Promise<void>;

  /** Inserts a run.*/
  createRun(input: CreateScheduleRunInput, transaction?: TTransaction): Promise<ScheduleRunRecord>;
  /** Drops the scheduled run (pause, manifest edit, delete-and-reinsert). Idempotent. */
  deleteScheduledRun(input: GetScheduleInput, transaction?: TTransaction): Promise<void>;
  /**
   * Runs scheduled now, oldest slot first.
   */
  findScheduledRuns(input: FindScheduledRunsInput, transaction?: TTransaction): Promise<ScheduleRunRecord[]>;
  /**
   * Guarded `scheduled -> triggered` transition, stamping `started_at`.
   *
   * Returns undefined when the row is no longer `scheduled` (e.g. pause dropped
   * it between the due query and this claim).
   */
  triggerRun(input: TriggerScheduleRunInput, transaction?: TTransaction): Promise<ScheduleRunRecord | undefined>;
  /** Writes a terminal status. Returns undefined if the run is gone. */
  finishRun(input: FinishScheduleRunInput, transaction?: TTransaction): Promise<ScheduleRunRecord | undefined>;
}
