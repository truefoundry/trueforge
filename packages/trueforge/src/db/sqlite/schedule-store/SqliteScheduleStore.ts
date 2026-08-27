import { sql, type ExpressionBuilder, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { ulid } from 'ulid';
import type { ScheduleManifest, ScheduleStatus } from '../../../schemas/schedule';
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
  type ScheduleRunStatus,
  type TriggerScheduleRunInput,
  type UpdateScheduleInput,
} from '../../scheduleStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/**
 * Database clock in the same wire format as `Date.prototype.toISOString()`
 * (`%f` is `SS.SSS`), so comparisons against stored TEXT timestamps stay
 * lexicographic. Mirrors Postgres `now()` — one due-ness authority per engine,
 * never the process clock.
 */
function nowIsoSql(): RawBuilder<string> {
  return sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
}

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function scheduleColumns(eb: ExpressionBuilder<Database, 'schedule'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'agent_id' as const,
    'name' as const,
    jsonText<ScheduleManifest>(eb.ref('manifest')).as('manifest'),
    'status' as const,
    'created_by' as const,
    'created_at' as const,
    'updated_at' as const,
  ];
}

const RUN_COLUMNS = [
  'id',
  'tenant_id',
  'schedule_id',
  'name',
  'scheduled_for',
  'status',
  'triggered_by',
  'started_at',
  'created_at',
  'updated_at',
] as const;

interface ScheduleRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  name: string;
  manifest: ScheduleManifest;
  status: ScheduleStatus;
  created_by: string;
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
  triggered_by: string;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

function toScheduleRecord(row: ScheduleRow): ScheduleRecord {
  return { ...row, manifest: parseStoredScheduleManifest(row.manifest) };
}

function toRunRecord(row: RunRow): ScheduleRunRecord {
  return { ...row };
}

export class SqliteScheduleStore implements IScheduleStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSchedules(input: ListSchedulesInput, transaction?: Transaction<Database>): Promise<ScheduleRecord[]> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('schedule').select(scheduleColumns).where('tenant_id', '=', input.tenant_id);
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
      .select(scheduleColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  async createSchedule(input: CreateScheduleInput, transaction?: Transaction<Database>): Promise<ScheduleRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    const row = await db
      .insertInto('schedule')
      .values({
        id: ulid().toLowerCase(),
        tenant_id: input.tenant_id,
        agent_id: input.agent_id,
        name: input.name,
        manifest: jsonbBind(input.manifest),
        // Column mirrors the manifest so the due scan and API reads share one value.
        status: input.manifest.status,
        created_by: input.created_by,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(scheduleColumns)
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
    return row === undefined ? undefined : toScheduleRecord(row);
  }

  async deleteSchedule(input: DeleteScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('schedule').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  async createRun(input: CreateScheduleRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    const row = await db
      .insertInto('schedule_run')
      .values({
        id: ulid().toLowerCase(),
        tenant_id: input.tenant_id,
        schedule_id: input.schedule_id,
        name: input.name,
        scheduled_for: input.scheduled_for.toISOString(),
        status: input.status,
        triggered_by: input.triggered_by,
        started_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(RUN_COLUMNS)
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
    const rows = await db
      .selectFrom('schedule_run')
      .select(RUN_COLUMNS)
      .where('status', '=', 'scheduled')
      .where('scheduled_for', '<=', nowIsoSql())
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
    const timestamp = nowIso();
    // Guarded on `status = 'scheduled'`: a pause that dropped the row between
    // the due query and here is a no-op.
    const row = await db
      .updateTable('schedule_run')
      .set({ status: 'triggered', started_at: timestamp, updated_at: timestamp })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .where('status', '=', 'scheduled')
      .returning(RUN_COLUMNS)
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
      .set({ status: input.status, updated_at: nowIso() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id);
    if (input.expected_status !== undefined) {
      query = query.where('status', '=', input.expected_status);
    }
    const row = await query.returning(RUN_COLUMNS).executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }
}
