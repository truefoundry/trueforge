import { sql, type ExpressionBuilder, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { ulid } from 'ulid';
import { nextFireAfter } from '../../../runtime/cron';
import type { ScheduleManifest, ScheduleStatus } from '../../../schemas/schedule';
import {
  cronRunName,
  parseStoredScheduleManifest,
  shouldSyncPendingRun,
  type CreateScheduleInput,
  type CreateScheduleRunInput,
  type DeleteScheduleInput,
  type FindScheduledRunsInput,
  type GetRunInput,
  type GetScheduleInput,
  type IScheduleStore,
  type ListSchedulesInput,
  type ScheduleRecord,
  type ScheduleRunRecord,
  type ScheduleRunStatus,
  type ScheduleWriteResult,
  type UpdateScheduleInput,
  type UpdateScheduleRunStatusInput,
} from '../../scheduleStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/**
 * Database clock in the same wire format as `Date.prototype.toISOString()`
 * (`%f` is `SS.SSS`), so comparisons against stored TEXT timestamps stay
 * lexicographic. Mirrors Postgres `now()` — one scheduled_for clock authority per engine,
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
    'agent_name' as const,
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
  'triggered_at',
  'created_at',
  'updated_at',
] as const;

interface ScheduleRow {
  id: string;
  tenant_id: string;
  agent_name: string;
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
  triggered_at: string | null;
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

  async createScheduleAndRun(
    input: CreateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleWriteResult> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    const row = await db
      .insertInto('schedule')
      .values({
        id: ulid().toLowerCase(),
        tenant_id: input.tenant_id,
        agent_name: input.agent_name,
        name: input.name,
        manifest: jsonbBind(input.manifest),
        // Column mirrors the manifest so the dispatch scan and API reads share one value.
        status: input.manifest.status,
        created_by: input.created_by,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(scheduleColumns)
      .executeTakeFirstOrThrow();
    const schedule = toScheduleRecord(row);
    const pendingRun = await this.#syncPendingRun(schedule, input.runFrom, transaction);
    return { schedule, pendingRun };
  }

  async updateScheduleAndRun(
    input: UpdateScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleWriteResult | undefined> {
    const previous = await this.getSchedule(
      { tenant_id: input.tenant_id, id: input.id },
      transaction,
    );
    if (previous === undefined) {
      return undefined;
    }

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
    if (row === undefined) {
      return undefined;
    }
    const schedule = toScheduleRecord(row);
    if (!shouldSyncPendingRun(previous, schedule)) {
      const pendingRun = await this.getScheduledRun(
        { tenant_id: schedule.tenant_id, id: schedule.id },
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
    await this.deleteScheduledRun({ tenant_id: schedule.tenant_id, id: schedule.id }, transaction);
    if (schedule.status !== 'active') {
      return undefined;
    }
    const nextFire = nextFireAfter(schedule.manifest.cron, schedule.manifest.timezone, from);
    return this.createRun(
      {
        tenant_id: schedule.tenant_id,
        schedule_id: schedule.id,
        name: cronRunName(nextFire),
        scheduled_for: nextFire,
        status: 'scheduled',
        triggered_by: schedule.created_by,
      },
      transaction,
    );
  }

  async deleteSchedule(input: DeleteScheduleInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('schedule').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  async listSchedules(input: ListSchedulesInput, transaction?: Transaction<Database>): Promise<ScheduleRecord[]> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('schedule').select(scheduleColumns).where('tenant_id', '=', input.tenant_id);
    if (input.agent_name !== undefined) {
      query = query.where('agent_name', '=', input.agent_name);
    }
    const rows = await query.orderBy('created_at', 'desc').orderBy('id').execute();
    return rows.map(toScheduleRecord);
  }

  async getRun(input: GetRunInput, transaction?: Transaction<Database>): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule_run')
      .select(RUN_COLUMNS)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
  }

  async getScheduledRun(
    input: GetScheduleInput,
    transaction?: Transaction<Database>,
  ): Promise<ScheduleRunRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('schedule_run')
      .select(RUN_COLUMNS)
      .where('tenant_id', '=', input.tenant_id)
      .where('schedule_id', '=', input.id)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
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
        triggered_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(RUN_COLUMNS)
      .executeTakeFirstOrThrow();
    return toRunRecord(row);
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
      .returning(RUN_COLUMNS)
      .executeTakeFirst();
    return row === undefined ? undefined : toRunRecord(row);
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
}
