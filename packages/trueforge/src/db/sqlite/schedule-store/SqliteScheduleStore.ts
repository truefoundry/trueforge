import type { CreatedBySubject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
import { nextTriggerAfter } from '../../../runtime/cron';
import type { ScheduleManifest, ScheduleRunStatus, ScheduleStatus } from '../../../schemas/schedule';
import { newId } from '../../../utils/id';
import { parseStoredCreatedBySubject } from '../../createdBySubject';
import {
  cronRunName,
  parseStoredScheduleManifest,
  ScheduleNameConflictError,
  ScheduleRunConflictError,
  shouldSyncPendingRun,
  type CreateScheduleInput,
  type CreateScheduleRunInput,
  type DeleteScheduleInput,
  type GetRunInput,
  type GetScheduledRunForInput,
  type GetScheduleInput,
  type IScheduleStore,
  type ListRunsInput,
  type ListScheduledRunsInput,
  type ListSchedulesInput,
  type ScheduleRecord,
  type ScheduleRunRecord,
  type ScheduleWriteResult,
  type UpdateScheduleInput,
  type UpdateScheduleRunStatusInput,
} from '../../scheduleStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function scheduleColumns(eb: ExpressionBuilder<Database, 'schedule'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'agent_name' as const,
    'name' as const,
    jsonText<ScheduleManifest>(eb.ref('manifest')).as('manifest'),
    'status' as const,
    jsonText<CreatedBySubject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

function runColumns(eb: ExpressionBuilder<Database, 'schedule_run'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'schedule_id' as const,
    'name' as const,
    'scheduled_for' as const,
    'status' as const,
    jsonText<CreatedBySubject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'triggered_at' as const,
    'created_at' as const,
    'updated_at' as const,
  ];
}

interface ScheduleRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  name: string;
  manifest: ScheduleManifest;
  status: ScheduleStatus;
  created_by_subject: CreatedBySubject;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  tenant_id: string;
  schedule_id: string;
  name: string;
  scheduled_for: string;
  status: ScheduleRunStatus;
  created_by_subject: CreatedBySubject;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

function toScheduleRecord(row: ScheduleRow): ScheduleRecord {
  return {
    ...row,
    manifest: parseStoredScheduleManifest(row.manifest),
    created_by_subject: parseStoredCreatedBySubject(row.created_by_subject),
  };
}

function toRunRecord(row: RunRow): ScheduleRunRecord {
  return {
    ...row,
    created_by_subject: parseStoredCreatedBySubject(row.created_by_subject),
  };
}

export class SqliteScheduleStore implements IScheduleStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getSchedule(input: GetScheduleInput, transaction?: Transaction<Database>): Promise<ScheduleRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule')
      .select(scheduleColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  /**
   * SQLite has no `SELECT ... FOR UPDATE`. A write transaction still serializes
   * the lock-ordering Postgres needs.
   */
  async getScheduleForUpdate(
    input: GetScheduleInput,
    transaction: Transaction<Database>,
  ): Promise<ScheduleRecord | undefined> {
    return this.getSchedule(input, transaction);
  }

  async createScheduleAndRun(
    input: CreateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleWriteResult> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    let row;
    try {
      row = await db
        .insertInto('schedule')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          agent_name: input.agent_name,
          name: input.name,
          manifest: jsonbBind(input.manifest),
          // Column mirrors the manifest so the dispatch scan and API reads share one value.
          status: input.manifest.status,
          created_by_subject: jsonbBind(input.created_by_subject),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(scheduleColumns)
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ScheduleNameConflictError(
          { tenant_id: input.tenant_id, agent_name: input.agent_name, name: input.name },
          { cause: error },
        );
      }
      throw error;
    }
    const schedule = toScheduleRecord(row);
    const pendingRun = await this.#syncPendingRun(schedule, input.runFrom, transaction);
    return { schedule, pendingRun };
  }

  async updateScheduleAndRun(
    input: UpdateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleWriteResult | undefined> {
    // Lock first: this transaction writes the schedule AND its runs, and every such
    // transaction must take the schedule lock before touching a run row (see the
    // lock-ordering note in `controller/scheduleDispatch.ts`). A no-op here; Postgres
    // is where it matters.
    const previous =
      transaction !== undefined
        ? await this.getScheduleForUpdate({ tenant_id: input.tenant_id, id: input.id }, transaction)
        : await this.getSchedule({ tenant_id: input.tenant_id, id: input.id });
    if (previous === undefined) {
      return undefined;
    }

    const db = transaction ?? this.#db;
    let row;
    try {
      row = await db
        .updateTable('schedule')
        .set({
          name: input.name,
          manifest: jsonbBind(input.manifest),
          status: input.manifest.status,
          updated_at: nowIso(),
        })
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .returning(scheduleColumns)
        .executeTakeFirst();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ScheduleNameConflictError(
          { tenant_id: input.tenant_id, agent_name: previous.agent_name, name: input.name },
          { cause: error },
        );
      }
      throw error;
    }
    if (row === undefined) {
      return undefined;
    }
    const schedule = toScheduleRecord(row);
    if (!shouldSyncPendingRun(previous, schedule)) {
      const pendingRun = await this.getScheduledRunFor(
        { tenant_id: schedule.tenant_id, schedule_id: schedule.id },
        transaction,
      );
      return { schedule, pendingRun };
    }
    const pendingRun = await this.#syncPendingRun(schedule, input.runFrom, transaction);
    return { schedule, pendingRun };
  }

  async #syncPendingRun(
    schedule: ScheduleRecord,
    from: Date,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    // Clear the pending run, if any; whether a replacement follows depends on status.
    await db
      .deleteFrom('schedule_run')
      .where('tenant_id', '=', schedule.tenant_id)
      .where('schedule_id', '=', schedule.id)
      .where('status', '=', 'scheduled')
      .execute();
    if (schedule.status !== 'active') {
      return undefined;
    }
    const nextTrigger = nextTriggerAfter({
      cron: schedule.manifest.cron,
      timezone: schedule.manifest.timezone,
      from,
    });
    return this.createRun(
      {
        tenant_id: schedule.tenant_id,
        schedule_id: schedule.id,
        name: cronRunName(nextTrigger),
        scheduled_for: nextTrigger,
        status: 'scheduled',
        created_by_subject: schedule.created_by_subject,
      },
      transaction,
    );
  }

  async deleteSchedule(input: DeleteScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('schedule').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  async listSchedules(
    input: ListSchedulesInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: ScheduleRecord[]; pagination: TokenPagination }> {
    const offset = decodeOffsetPageToken(input.page_token);
    const db = transaction ?? this.#db;
    let query = db.selectFrom('schedule').select(scheduleColumns).where('tenant_id', '=', input.tenant_id);
    if (input.agent_names !== undefined) {
      query = query.where('agent_name', 'in', [...input.agent_names]);
    }
    if (input.created_by_subject_id !== undefined) {
      query = query.where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const { data, pagination } = paginateOffsetRows(rows, input.limit, offset);
    return { data: data.map(toScheduleRecord), pagination };
  }

  async listRuns(input: ListRunsInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('schedule_run')
      .select(runColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('schedule_id', '=', input.schedule_id)
      .orderBy('scheduled_for', 'desc')
      .orderBy('id')
      .execute();
    return rows.map(toRunRecord);
  }

  async getRun(input: GetRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule_run')
      .select(runColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async getScheduledRunFor(
    input: GetScheduledRunForInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule_run')
      .select(runColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('schedule_id', '=', input.schedule_id)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async createRun(input: CreateScheduleRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    try {
      const row = await db
        .insertInto('schedule_run')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          schedule_id: input.schedule_id,
          name: input.name,
          scheduled_for: input.scheduled_for.toISOString(),
          status: input.status,
          created_by_subject: jsonbBind(input.created_by_subject),
          triggered_at: input.triggered_at?.toISOString() ?? null,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(runColumns)
        .executeTakeFirstOrThrow();
      return toRunRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ScheduleRunConflictError(`Schedule run already exists: ${input.name}`, { cause: error });
      }
      throw error;
    }
  }

  async updateRunStatus(
    input: UpdateScheduleRunStatusInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    const patch =
      input.status === 'triggered'
        ? { status: input.status, triggered_at: timestamp, updated_at: timestamp }
        : { status: input.status, updated_at: timestamp };
    const row = await db
      .updateTable('schedule_run')
      .set(patch)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returning(runColumns)
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async listScheduledRuns(
    input: ListScheduledRunsInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('schedule_run')
      .select(runColumns)
      .where('status', '=', 'scheduled')
      .where('scheduled_for', '<=', input.until.toISOString())
      .orderBy('scheduled_for')
      .limit(input.limit)
      .execute();
    return rows.map(toRunRecord);
  }
}
