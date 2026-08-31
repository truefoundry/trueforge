import type { Kysely, Selectable, Transaction } from 'kysely';
import { nextTriggerAfter } from '../../../runtime/cron';
import { newId } from '../../../utils/id';
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
import { json, now } from '../sqlExpressions';
import type { Database, ScheduleRunTable, ScheduleTable } from '../types';

function toScheduleRecord(row: Selectable<ScheduleTable>): ScheduleRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    agent_name: row.agent_name,
    name: row.name,
    manifest: parseStoredScheduleManifest(row.manifest),
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toRunRecord(row: Selectable<ScheduleRunTable>): ScheduleRunRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    schedule_id: row.schedule_id,
    name: row.name,
    scheduled_for: row.scheduled_for.toISOString(),
    status: row.status,
    triggered_by: row.triggered_by,
    triggered_at: row.triggered_at === null ? null : row.triggered_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresScheduleStore implements IScheduleStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
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
        triggered_by: schedule.created_by,
      },
      transaction,
    );
  }

  async getSchedule(input: GetScheduleInput, transaction?: Transaction<Database>): Promise<ScheduleRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  async getScheduleForUpdate(
    input: GetScheduleInput,
    transaction: Transaction<Database>,
  ): Promise<ScheduleRecord | undefined> {
    const row = await transaction
      .selectFrom('schedule')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .forUpdate()
      .executeTakeFirst();
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  async createScheduleAndRun(
    input: CreateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleWriteResult> {
    const db = transaction ?? this.#db;
    let row;
    try {
      row = await db
        .insertInto('schedule')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          agent_name: input.agent_name,
          name: input.name,
          manifest: json(input.manifest),
          // Column mirrors the manifest so the dispatch scan and API reads share one value.
          status: input.manifest.status,
          created_by: input.created_by,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
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
    // transaction must take the schedule lock before touching a run row.
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
        .set({ name: input.name, manifest: json(input.manifest), status: input.manifest.status, updated_at: now() })
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .returningAll()
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

  async deleteSchedule(input: DeleteScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('schedule').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  async listSchedules(input: ListSchedulesInput, transaction?: Transaction<Database>): Promise<ScheduleRecord[]> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('schedule').selectAll().where('tenant_id', '=', input.tenant_id);
    if (input.agent_name !== undefined) {
      query = query.where('agent_name', '=', input.agent_name);
    }
    if (input.created_by !== undefined) {
      query = query.where('created_by', '=', input.created_by);
    }
    const rows = await query.orderBy('created_at', 'desc').orderBy('id').execute();
    return rows.map(toScheduleRecord);
  }

  async listRuns(input: ListRunsInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('schedule_run')
      .selectAll()
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
      .selectAll()
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
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('schedule_id', '=', input.schedule_id)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async createRun(input: CreateScheduleRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('schedule_run')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          schedule_id: input.schedule_id,
          name: input.name,
          scheduled_for: input.scheduled_for,
          status: input.status,
          triggered_by: input.triggered_by,
          triggered_at: input.triggered_at ?? null,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
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
    const patch =
      input.status === 'triggered'
        ? { status: input.status, triggered_at: now(), updated_at: now() }
        : { status: input.status, updated_at: now() };
    const row = await db
      .updateTable('schedule_run')
      .set(patch)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
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
      .selectAll()
      .where('status', '=', 'scheduled')
      .where('scheduled_for', '<=', input.until)
      .orderBy('scheduled_for')
      .limit(input.limit)
      .execute();
    return rows.map(toRunRecord);
  }
}
