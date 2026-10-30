import {
  MAIN_THREAD_ID,
  type CreatedBySubject,
  type PersistedTurnEvent,
  type TurnInputItem,
  type TurnState,
} from '@truefoundry/trueforge-core/agent-session';
import { sql, type Kysely } from 'kysely';
import {
  AGENT_MEMORY_ENABLED_PATH,
  type IMemoryIngestStore,
  type ListMemoryIngestCandidatesInput,
  type MemoryIngestCandidate,
  type MemoryIngestModelMessage,
  type MemoryIngestTurn,
  type UpsertMemoryIngestCursorInput,
} from '../../memoryIngestStore';
import { jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

// TODO(agent-memory-toggle): read through a typed MemoryConfig once RuntimeConfigSchema has one.
const agentMemoryEnabled = sql<number>`json_type(a.manifest, ${sql.lit(`$.${AGENT_MEMORY_ENABLED_PATH.join('.')}`)}) IS 'true'`;
const tfgSource = sql<string | null>`json_extract(s.metadata, '$."tfg.source"')`;
/** Same terms as SESSION_MEMORY_INGEST_IDX (literal, not a bind) so SQLite can use the partial index. */
const memoryIngestIndexPredicate = sql<boolean>`s.source IS NULL AND (json_extract(s.metadata, '$."tfg.source"') = 'ui' OR s.agent_id IS NOT NULL)`;

/** Mirrors PostgresMemoryIngestStore; timestamps are ISO-8601 TEXT. */
export class SqliteMemoryIngestStore implements IMemoryIngestStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listCandidateSessions(input: ListMemoryIngestCandidatesInput): Promise<MemoryIngestCandidate[]> {
    const { after } = input;
    let query = this.#db
      .selectFrom('session as s')
      .innerJoin('turn as t', join =>
        join
          .onRef('t.session_id', '=', 's.session_id')
          .on(sql<boolean>`t.turn_id = json_extract(s.last_turn_details, '$.id')`),
      )
      .leftJoin('agent as a', join => join.onRef('a.id', '=', 's.agent_id').onRef('a.tenant_id', '=', 's.tenant_id'))
      .leftJoin('memory_ingest_cursor as c', 'c.session_id', 's.session_id')
      .select([
        's.session_id',
        's.tenant_id',
        jsonText<CreatedBySubject>(sql.ref('s.created_by_subject')).as('created_by_subject'),
        's.agent_id',
        's.agent_name',
        tfgSource.as('tfg_source'),
        agentMemoryEnabled.as('agent_memory_enabled'),
        't.turn_id as tip_turn_id',
        't.updated_at as tip_updated_at',
        's.updated_at as session_updated_at',
        'c.last_ingested_turn_id as cursor_last_ingested_turn_id',
        'c.external_thread_id as cursor_external_thread_id',
        'c.last_error as cursor_last_error',
        'c.updated_at as cursor_updated_at',
      ])
      .where(memoryIngestIndexPredicate)
      .where('s.updated_at', '>=', input.updated_since.toISOString())
      // Matches resolveMemoryScope: a bound agent's manifest decides; UI chats without one use the default scope.
      .where(eb =>
        eb.or([eb.and([eb('s.agent_id', 'is', null), eb(tfgSource, '=', 'ui')]), eb(agentMemoryEnabled, '=', 1)]),
      )
      .where(sql<boolean>`c.last_ingested_turn_id IS NOT t.turn_id`);
    if (after !== undefined) {
      query = query.where(
        sql<boolean>`(s.updated_at, s.session_id) > (${after.session_updated_at}, ${after.session_id})`,
      );
    }
    const rows = await query.orderBy('s.updated_at', 'asc').orderBy('s.session_id', 'asc').limit(input.limit).execute();

    return rows.map(row => ({
      session_id: row.session_id,
      tenant_id: row.tenant_id,
      created_by_subject: row.created_by_subject,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      tfg_source: row.tfg_source,
      agent_memory_enabled: row.agent_memory_enabled === 1,
      tip_turn_id: row.tip_turn_id,
      tip_updated_at: row.tip_updated_at,
      session_updated_at: row.session_updated_at,
      cursor:
        row.cursor_updated_at === null
          ? null
          : {
              session_id: row.session_id,
              last_ingested_turn_id: row.cursor_last_ingested_turn_id,
              external_thread_id: row.cursor_external_thread_id,
              last_error: row.cursor_last_error,
              updated_at: row.cursor_updated_at,
            },
    }));
  }

  async listSessionTurns(input: { session_id: string }): Promise<MemoryIngestTurn[]> {
    return await this.#db
      .selectFrom('turn')
      .select([
        'turn_id',
        'previous_turn_id',
        jsonText<TurnInputItem[]>(sql.ref('input')).as('input'),
        jsonText<TurnState>(sql.ref('state')).as('state'),
        'created_at',
      ])
      .where('session_id', '=', input.session_id)
      .orderBy('created_at', 'asc')
      .orderBy('turn_id', 'asc')
      .execute();
  }

  async listMainThreadModelMessages(input: {
    session_id: string;
    turn_ids: readonly string[];
  }): Promise<MemoryIngestModelMessage[]> {
    if (input.turn_ids.length === 0) {
      return [];
    }
    const rows = await this.#db
      .selectFrom('session_event')
      .select(['turn_id', jsonText<PersistedTurnEvent>(sql.ref('event')).as('event')])
      .where('session_id', '=', input.session_id)
      .where('turn_id', 'in', [...input.turn_ids])
      .where(sql<string>`json_extract(event, '$.type')`, '=', 'model.message')
      .where(sql<string>`json_extract(event, '$.thread_id')`, '=', MAIN_THREAD_ID)
      .orderBy('turn_id', 'asc')
      .orderBy('event_id', 'asc')
      .execute();
    return rows.flatMap(row =>
      row.event.type === 'model.message' ? [{ turn_id: row.turn_id, message: row.event }] : [],
    );
  }

  async upsertCursor(input: UpsertMemoryIngestCursorInput): Promise<void> {
    const values = {
      last_ingested_turn_id: input.last_ingested_turn_id,
      external_thread_id: input.external_thread_id,
      last_error: input.last_error,
      updated_at: nowIso(),
    };
    await this.#db
      .insertInto('memory_ingest_cursor')
      .values({ session_id: input.session_id, ...values })
      .onConflict(oc => oc.column('session_id').doUpdateSet(values))
      .execute();
  }
}
