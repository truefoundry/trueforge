import { MAIN_THREAD_ID, type TurnInputItem } from '@truefoundry/trueforge-core/agent-session';
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
import { now } from '../sqlExpressions';
import type { Database } from '../types';

const agentMemoryEnabled = sql<string | null>`a.manifest #>> ${sql.lit(`{${AGENT_MEMORY_ENABLED_PATH.join(',')}}`)}`;
const tfgSource = sql<string | null>`s.metadata->>'tfg.source'`;
/**
 * `turn.input` with only text parts kept in array content: file parts carry inline base64, and
 * ingestion sends text only, so attachments never leave the database.
 */
const textOnlyInput = sql<TurnInputItem[]>`(
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(item->'content') = 'array' THEN jsonb_set(item, '{content}', COALESCE(
      (SELECT jsonb_agg(part ORDER BY part_index)
         FROM jsonb_array_elements(item->'content') WITH ORDINALITY AS p(part, part_index)
        WHERE part->>'type' = 'text'),
      '[]'::jsonb))
    ELSE item END
    ORDER BY item_index), '[]'::jsonb)
  FROM jsonb_array_elements(input) WITH ORDINALITY AS i(item, item_index)
)`;
/** The tip turn finished waiting on the user (a question, approval or auth). */
const tipPaused = sql<boolean>`(t.state->>'status' = 'done' AND jsonb_array_length(COALESCE(t.state->'required_actions', '[]'::jsonb)) > 0)`;
/** Microsecond ISO text, so the keyset round-trips exactly. */
const sessionUpdatedAtText = sql<string>`to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export class PostgresMemoryIngestStore implements IMemoryIngestStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listCandidateSessions(input: ListMemoryIngestCandidatesInput): Promise<MemoryIngestCandidate[]> {
    const { after } = input;
    let query = this.#db
      .selectFrom('session as s')
      .innerJoin('turn as t', join =>
        join.onRef('t.session_id', '=', 's.session_id').on(sql<boolean>`t.turn_id = s.last_turn_details->>'id'`),
      )
      .leftJoin('agent as a', join => join.onRef('a.id', '=', 's.agent_id').onRef('a.tenant_id', '=', 's.tenant_id'))
      .leftJoin('memory_ingest_cursor as c', 'c.session_id', 's.session_id')
      .select([
        's.session_id',
        's.tenant_id',
        's.created_by_subject',
        's.agent_id',
        's.agent_name',
        tfgSource.as('tfg_source'),
        sql<boolean>`COALESCE(${agentMemoryEnabled} = 'true', false)`.as('agent_memory_enabled'),
        't.turn_id as tip_turn_id',
        't.updated_at as tip_updated_at',
        sessionUpdatedAtText.as('session_updated_at'),
        'c.last_ingested_turn_id as cursor_last_ingested_turn_id',
        'c.external_thread_id as cursor_external_thread_id',
        'c.last_error as cursor_last_error',
        'c.updated_at as cursor_updated_at',
      ])
      .where('s.source', 'is', null)
      .where(eb =>
        eb.or([
          eb('s.updated_at', '>=', input.recent_since),
          eb.and([eb('s.updated_at', '>=', input.paused_from), eb('s.updated_at', '<', input.paused_until), tipPaused]),
        ]),
      )
      // Matches resolveMemoryScope: a bound agent's manifest decides; UI chats without one use the default scope.
      .where(eb =>
        eb.or([eb.and([eb('s.agent_id', 'is', null), eb(tfgSource, '=', 'ui')]), eb(agentMemoryEnabled, '=', 'true')]),
      )
      .where(sql<boolean>`c.last_ingested_turn_id IS DISTINCT FROM t.turn_id`);
    if (after !== undefined) {
      query = query.where(
        sql<boolean>`(s.updated_at, s.session_id) > (${after.session_updated_at}::timestamptz, ${after.session_id})`,
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
      agent_memory_enabled: row.agent_memory_enabled,
      tip_turn_id: row.tip_turn_id,
      tip_updated_at: row.tip_updated_at.toISOString(),
      session_updated_at: row.session_updated_at,
      cursor:
        row.cursor_updated_at === null
          ? null
          : {
              session_id: row.session_id,
              last_ingested_turn_id: row.cursor_last_ingested_turn_id,
              external_thread_id: row.cursor_external_thread_id,
              last_error: row.cursor_last_error,
              updated_at: row.cursor_updated_at.toISOString(),
            },
    }));
  }

  async listSessionTurns(input: { session_id: string }): Promise<MemoryIngestTurn[]> {
    const rows = await this.#db
      .selectFrom('turn')
      .select(['turn_id', 'previous_turn_id', textOnlyInput.as('input'), 'state', 'created_at'])
      .where('session_id', '=', input.session_id)
      .orderBy('created_at', 'asc')
      .orderBy('turn_id', 'asc')
      .execute();
    return rows.map(row => ({ ...row, created_at: row.created_at.toISOString() }));
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
      .select(['turn_id', 'event'])
      .where('session_id', '=', input.session_id)
      .where('turn_id', 'in', [...input.turn_ids])
      .where(sql<string>`event->>'type'`, '=', 'model.message')
      .where(sql<string>`event->>'thread_id'`, '=', MAIN_THREAD_ID)
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
      updated_at: now(),
    };
    await this.#db
      .insertInto('memory_ingest_cursor')
      .values({ session_id: input.session_id, ...values })
      .onConflict(oc => oc.column('session_id').doUpdateSet(values))
      .execute();
  }
}
