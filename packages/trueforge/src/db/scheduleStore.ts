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
import type { CreatedBySubject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { randomUUID } from 'node:crypto';
import {
  ScheduleManifestSchema,
  type ScheduleManifest,
  type ScheduleRunStatus,
  type ScheduleStatus,
} from '../schemas/schedule';

/**
 * `sched-<unixSeconds>` or `manual-<token>` — one name per trigger time, which is what makes
 * `schedule_run_name_idx` reject a duplicated trigger.
 */
export function cronRunName(scheduledFor: Date): string {
  return `sched-${String(Math.floor(scheduledFor.getTime() / 1000))}`;
}

/** Unique run name for an immediate (run-now) trigger. */
export function manualRunName(): string {
  return `manual-${randomUUID()}`;
}

export interface ScheduleRecord {
  id: string;
  tenant_id: string;
  /** Immutable FK to `agent.name` (with tenant); agent version resolves at run time. */
  agent_name: string;
  /** Slug-shaped label, unique per agent (`schedule_name_uq`). */
  name: string;
  manifest: ScheduleManifest;
  status: ScheduleStatus;
  created_by_subject: CreatedBySubject;
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
  created_by_subject: CreatedBySubject;
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
  limit: number;
  page_token: string | undefined;
  /** When set, only schedules for these agent names */
  agent_names: readonly string[] | undefined;
  created_by_subject_id?: string | undefined;
}

/** User-facing run listing, scoped to one schedule. */
export interface ListRunsInput {
  tenant_id: string;
  schedule_id: string;
}

export interface GetScheduleInput {
  tenant_id: string;
  id: string;
}

export interface CreateScheduleInput {
  tenant_id: string;
  agent_name: string;
  name: string;
  manifest: ScheduleManifest;
  created_by_subject: CreatedBySubject;
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
  created_by_subject: CreatedBySubject;
  status: ScheduleRunStatus;
  triggered_at?: Date | null;
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

/** Schedule name already taken for this agent — violates `schedule_name_uq`. */
export class ScheduleNameConflictError extends Error {
  readonly tenant_id: string;
  readonly agent_name: string;
  readonly schedule_name: string;

  constructor(
    { tenant_id, agent_name, name }: { tenant_id: string; agent_name: string; name: string },
    options?: ErrorOptions,
  ) {
    super(`Schedule name already exists for agent ${agent_name}: ${name}`, options);
    this.name = 'ScheduleNameConflictError';
    this.tenant_id = tenant_id;
    this.agent_name = agent_name;
    this.schedule_name = name;
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
   * Load one schedule while holding a row lock for the lifetime of `transaction`.
   * Postgres: `SELECT … FOR UPDATE`. SQLite: plain read under a write txn.
   */
  getScheduleForUpdate(input: GetScheduleInput, transaction: TTransaction): Promise<ScheduleRecord | undefined>;
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
  listSchedules(
    input: ListSchedulesInput,
    transaction?: TTransaction,
  ): Promise<{ data: ScheduleRecord[]; pagination: TokenPagination }>;

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
  /**
   * Runs of one schedule (any status), newest `scheduled_for` first.
   */
  listRuns(input: ListRunsInput, transaction?: TTransaction): Promise<ScheduleRunRecord[]>;
}
