import type { Kysely, Selectable, Transaction } from 'kysely';
import { ulid } from 'ulid';
import {
  parseStoredScheduleManifest,
  type CreateScheduleInput,
  type CreateScheduleRunInput,
  type DeleteScheduleInput,
  type FindScheduledRunsInput,
  type FinishScheduleRunInput,
  type GetScheduleInput,
  type IScheduleStore,
  type ListSchedulesInput,
  type ScheduleRecord,
  type ScheduleRunRecord,
  type TriggerScheduleRunInput,
  type UpdateScheduleInput,
} from '../../scheduleStore';
import { json, now } from '../sqlExpressions';
import type { Database, ScheduleRunTable, ScheduleTable } from '../types';

function toScheduleRecord(row: Selectable<ScheduleTable>): ScheduleRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    agent_id: row.agent_id,
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
    started_at: row.started_at === null ? null : row.started_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresScheduleStore implements IScheduleStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSchedules(input: ListSchedulesInput, transaction?: Transaction<Database>): Promise<ScheduleRecord[]> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('schedule').selectAll().where('tenant_id', '=', input.tenant_id);
    if (input.agent_id !== undefined) {
      query = query.where('agent_id', '=', input.agent_id);
    }
    const rows = await query.orderBy('created_at', 'desc').orderBy('id').execute();
    return rows.map(toScheduleRecord);
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

  async createSchedule(input: CreateScheduleInput, transaction?: Transaction<Database>): Promise<ScheduleRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('schedule')
      .values({
        id: ulid().toLowerCase(),
        tenant_id: input.tenant_id,
        agent_id: input.agent_id,
        name: input.name,
        manifest: json(input.manifest),
        // Column mirrors the manifest so the due scan and API reads share one value.
        status: input.manifest.status,
        created_by: input.created_by,
        created_at: now(),
        updated_at: now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toScheduleRecord(row);
  }

  async updateSchedule(
    input: UpdateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('schedule')
      .set({ name: input.name, manifest: json(input.manifest), status: input.manifest.status, updated_at: now() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  async deleteSchedule(input: DeleteScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('schedule').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  async createRun(input: CreateScheduleRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('schedule_run')
      .values({
        id: ulid().toLowerCase(),
        tenant_id: input.tenant_id,
        schedule_id: input.schedule_id,
        name: input.name,
        scheduled_for: input.scheduled_for,
        status: input.status,
        triggered_by: input.triggered_by,
        started_at: null,
        created_at: now(),
        updated_at: now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRunRecord(row);
  }

  async deleteScheduledRun(input: GetScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db
      .deleteFrom('schedule_run')
      .where('tenant_id', '=', input.tenant_id)
      .where('schedule_id', '=', input.id)
      .where('status', '=', 'scheduled')
      .execute();
  }

  async findScheduledRuns(
    input: FindScheduledRunsInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord[]> {
    const db = transaction ?? this.#db;
    // Database clock, not the process clock: the dispatcher and the server are
    // separate pods in distributed mode.
    const rows = await db
      .selectFrom('schedule_run')
      .selectAll()
      .where('status', '=', 'scheduled')
      .where('scheduled_for', '<=', now())
      .orderBy('scheduled_for')
      .limit(input.limit)
      .execute();
    return rows.map(toRunRecord);
  }

  async triggerRun(
    input: TriggerScheduleRunInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('schedule_run')
      .set({ status: 'triggered', started_at: now(), updated_at: now() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .where('status', '=', 'scheduled')
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async finishRun(
    input: FinishScheduleRunInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    let query = db
      .updateTable('schedule_run')
      .set({ status: input.status, updated_at: now() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id);
    if (input.expected_status !== undefined) {
      query = query.where('status', '=', input.expected_status);
    }
    const row = await query.returningAll().executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }
}
