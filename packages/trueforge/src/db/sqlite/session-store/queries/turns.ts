import type { TurnRecord, TurnSnapshot } from '@truefoundry/trueforge-core/agent-session/models/TurnRecord';
import {
  type TerminalTurnState,
  type TurnInputItem,
  type TurnState,
} from '@truefoundry/trueforge-core/agent-session/schemas/turn';
import { assertCreateTurnThreadDelta } from '@truefoundry/trueforge-core/agent-session/store/assertCreateTurnThreadDelta';
import type {
  FreezeAndGetTurnInput,
  TurnRecordWithoutSnapshot,
  UpdateTurnStateInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  PreviousTurnRunningError,
  SessionNotFoundError,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  SessionStoreNotFoundError,
  TurnAlreadyExistsError,
  TurnNotFoundError,
  TurnNotRunningError,
} from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import type { CapabilityState, JsonValue } from '@truefoundry/trueforge-core/core/capabilities/AgentCapability';
import type { AgentInfo, AgentParent, MCPServerInitInfo } from '@truefoundry/trueforge-core/core/events/schema';
import type { AgentThreadSnapshot, ContextMessage } from '@truefoundry/trueforge-core/core/runtime/AgentThread.types';
import type { CurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import { getEmptyCurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import type { SandboxInfo } from '@truefoundry/trueforge-core/core/sandbox/Sandbox';
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { isUniqueViolation } from '../../client';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database, TurnCheckpoint, TurnThreadCheckpoint } from '../../types';
import { sortedByAppendId } from '../sqlExpressions';

type TurnCustom = Record<string, never>;

function isEmptyCustomRecord(value: Record<string, unknown>): value is TurnCustom {
  return Object.keys(value).length === 0;
}

function parseTurnCustom(value: Record<string, unknown> | null): TurnCustom | null {
  if (value === null) {
    return null;
  }
  if (!isEmptyCustomRecord(value)) {
    throw new SessionStoreInvariantError('non-empty turn custom is not supported');
  }
  return value;
}

/** New thread metadata; mutable per-turn data arrives through dedicated fields. */
export interface NewThreadRegistration {
  thread_id: string;
  parent: AgentParent | null;
  agent_info: AgentInfo | null;
}

export interface TurnKeys {
  session_id: string;
  turn_id: string;
}

export interface NewContextAppend {
  thread_id: string;
  context: ContextMessage[];
  current_context_usage: CurrentContextUsage | null;
}

export interface CreateTurnTurnFields {
  turn_id: string;
  first_turn_id: string;
  previous_turn_id: string | null;
  ancestor_ids: string[];
  input: TurnInputItem[];
  state: TurnState;
  custom: Record<string, unknown> | null;
}

export interface CreateTurnInput {
  session_id: string;
  turn: CreateTurnTurnFields;
  new_threads: NewThreadRegistration[];
  new_context_appends: NewContextAppend[];
  capability_states: {
    thread_id: string;
    capability_state: CapabilityState | null;
  }[];
  last_activity_timestamp_ms: number;
  update_session_title_if_not_exist: string | null;
  mcp_servers: Record<string, MCPServerInitInfo> | null;
  sandbox_info: SandboxInfo | null;
}

export interface GetTurnInput {
  session_id: string;
  turn_id: string;
}

export interface ListTurnsInput {
  session_id: string;
  limit: number;
  offset: number;
}

export interface ListTurnsResult {
  turns: TurnRecordWithoutSnapshot<TurnCustom>[];
  next_offset: number | null;
}

type DbOrTrx = Kysely<Database> | Transaction<Database>;

function terminalTurnState(state: TurnState, turn_id: string): TerminalTurnState {
  switch (state.status) {
    case 'running':
      throw new SessionStoreInvariantError(`expected terminal state for turn ${turn_id}, got running`);
    case 'done':
    case 'cancelled':
    case 'error':
      return state;
  }
}

async function loadTurnState(db: DbOrTrx, keys: TurnKeys): Promise<TurnState | undefined> {
  const row = await db
    .selectFrom('turn')
    .select([jsonText<TurnState>(sql.ref('state')).as('state')])
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .executeTakeFirst();
  return row?.state;
}

/** Classify a 0-row fenced write: missing turn vs frozen/non-running turn. */
export async function classifyTurnFenceWriteFailure(db: DbOrTrx, keys: TurnKeys): Promise<never> {
  const state = await loadTurnState(db, keys);
  if (!state) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  throw new TurnNotRunningError(keys.turn_id, terminalTurnState(state, keys.turn_id));
}

/**
 * Classify a 0-row fenced turn_thread UPDATE: turn missing/terminal vs thread row missing.
 */
export async function classifyTurnThreadWriteFailure(db: DbOrTrx, keys: TurnKeys, thread_id: string): Promise<never> {
  const state = await loadTurnState(db, keys);
  if (!state) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  if (state.status !== 'running') {
    throw new TurnNotRunningError(keys.turn_id, terminalTurnState(state, keys.turn_id));
  }
  throw new SessionStoreInvariantError(`thread ${thread_id} not found in turn ${keys.turn_id}`);
}

export async function assertTurnRunning(db: DbOrTrx, keys: TurnKeys): Promise<void> {
  const state = await loadTurnState(db, keys);
  if (!state) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  if (state.status !== 'running') {
    throw new TurnNotRunningError(keys.turn_id, terminalTurnState(state, keys.turn_id));
  }
}

interface CapabilityAggRow {
  thread_id: string;
  capability_state: Record<string, JsonValue> | null;
}

async function assembleTurnRecord(
  db: DbOrTrx,
  args: { session_id: string; turn_id: string },
): Promise<TurnRecord<TurnCustom> | undefined> {
  const turn = await db
    .selectFrom('turn')
    .select([
      'session_id',
      'turn_id',
      'first_turn_id',
      'previous_turn_id',
      jsonText<string[]>(sql.ref('ancestor_ids')).as('ancestor_ids'),
      jsonText<TurnInputItem[]>(sql.ref('input')).as('input'),
      jsonText<TurnState>(sql.ref('state')).as('state'),
      jsonText<TurnCheckpoint>(sql.ref('checkpoint')).as('checkpoint'),
      jsonText<Record<string, unknown> | null>(sql.ref('custom')).as('custom'),
      'created_at',
      'updated_at',
    ])
    .where('session_id', '=', args.session_id)
    .where('turn_id', '=', args.turn_id)
    .executeTakeFirst();

  if (!turn) {
    return undefined;
  }

  // LEFT JOIN turn_thread + turn_thread_context ORDER BY pos to assemble context per thread.
  // Empty-context threads emit one row with null pos/append_id from the LEFT JOIN.
  const contextRows = await db
    .selectFrom('turn_thread as tt')
    .leftJoin('turn_thread_context as ttc', join =>
      join
        .on('ttc.session_id', '=', args.session_id)
        .on('ttc.turn_id', '=', args.turn_id)
        .onRef('ttc.thread_id', '=', 'tt.thread_id'),
    )
    .leftJoin('thread_context_log as l', join =>
      join
        .on('l.session_id', '=', args.session_id)
        .onRef('l.thread_id', '=', 'tt.thread_id')
        .onRef('l.append_id', '=', 'ttc.append_id'),
    )
    .select([
      'tt.thread_id',
      jsonText<TurnThreadCheckpoint>(sql.ref('tt.checkpoint')).as('checkpoint'),
      jsonText<AgentInfo | null>(sql.ref('tt.agent_info')).as('agent_info'),
      jsonText<CurrentContextUsage>(sql.ref('tt.current_context_usage')).as('current_context_usage'),
      jsonText<ContextMessage | null>(sql.ref('l.body')).as('body'),
      'ttc.pos',
    ])
    .where('tt.session_id', '=', args.session_id)
    .where('tt.turn_id', '=', args.turn_id)
    .orderBy('tt.thread_id')
    .orderBy('ttc.pos')
    .execute();

  const capabilityRows: CapabilityAggRow[] = await db
    .selectFrom('thread_capability_state')
    .select([
      'thread_id',
      sql<Record<string, JsonValue> | null>`json(jsonb_group_object(key, json(state)))`.as('capability_state'),
    ])
    .where('session_id', '=', args.session_id)
    .where('turn_id', '=', args.turn_id)
    .groupBy('thread_id')
    .execute();

  const capabilityByThread = new Map<string, Record<string, JsonValue>>();
  for (const row of capabilityRows) {
    if (row.capability_state !== null) {
      capabilityByThread.set(row.thread_id, row.capability_state);
    }
  }

  const threads: Record<string, AgentThreadSnapshot> = {};
  const orderedBodies = new Map<string, ContextMessage[]>();
  const threadMeta = new Map<
    string,
    {
      checkpoint: TurnThreadCheckpoint;
      agent_info: AgentInfo | null;
      current_context_usage: CurrentContextUsage;
    }
  >();

  for (const row of contextRows) {
    if (!threadMeta.has(row.thread_id)) {
      threadMeta.set(row.thread_id, {
        checkpoint: row.checkpoint,
        agent_info: row.agent_info,
        current_context_usage: row.current_context_usage,
      });
      orderedBodies.set(row.thread_id, []);
    }
    if (row.body !== null) {
      const bodies = orderedBodies.get(row.thread_id);
      if (bodies !== undefined) {
        bodies.push(row.body);
      }
    }
  }

  for (const [threadId, meta] of threadMeta) {
    const context = orderedBodies.get(threadId) ?? [];
    const capability_state = capabilityByThread.get(threadId) ?? null;

    const snap: AgentThreadSnapshot = {
      thread_id: threadId,
      context,
      current_context_usage: meta.current_context_usage,
      parent: meta.checkpoint.parent,
      agent_info: meta.agent_info,
      completion: meta.checkpoint.completion,
      capability_state,
    };
    threads[threadId] = snap;
  }

  const checkpoint = turn.checkpoint;
  const snapshot: TurnSnapshot = {
    threads,
    mcp_servers: checkpoint.mcp_servers,
    sandbox_info: checkpoint.sandbox_info,
  };

  return {
    turn_id: turn.turn_id,
    session_id: turn.session_id,
    first_turn_id: turn.first_turn_id,
    ancestor_ids: turn.ancestor_ids,
    previous_turn_id: turn.previous_turn_id,
    state: turn.state,
    input: turn.input,
    snapshot,
    created_at: new Date(turn.created_at),
    updated_at: new Date(turn.updated_at),
    custom: parseTurnCustom(turn.custom),
  };
}

/**
 * createTurn — IMMEDIATE tx (BEGIN IMMEDIATE covers write locking; no FOR UPDATE/FOR SHARE).
 * Context order lives in turn_thread_context (pos, append_id); no context_ids array.
 */
export async function createTurn(db: Kysely<Database>, input: CreateTurnInput): Promise<void> {
  try {
    await db.transaction().execute(async trx => {
      // Step 1: read session tip; no FOR UPDATE (BEGIN IMMEDIATE is the lock).
      const locked = await trx
        .selectFrom('session')
        .select(['last_turn_id'])
        .where('session_id', '=', input.session_id)
        .executeTakeFirst();

      if (!locked) {
        throw new SessionNotFoundError(input.session_id);
      }

      // Step 2: bump session tip + optional title coalesce.
      let sessionUpdate = trx
        .updateTable('session')
        .set({
          last_turn_id: input.turn.turn_id,
          updated_at: nowIso(),
          last_activity_timestamp_ms: input.last_activity_timestamp_ms,
        })
        .where('session_id', '=', input.session_id);

      if (input.update_session_title_if_not_exist !== null) {
        const titleValue = input.update_session_title_if_not_exist;
        sessionUpdate = sessionUpdate.set({
          title: sql<string>`COALESCE(title, ${titleValue})`,
        });
      }

      await sessionUpdate.execute();

      const prevTurnId = input.turn.previous_turn_id;

      let prevCheckpoint: TurnCheckpoint | null = null;
      const prevThreadRows: {
        thread_id: string;
        checkpoint: TurnThreadCheckpoint;
        agent_info: AgentInfo | null;
        current_context_usage: CurrentContextUsage;
        context_pos_max: number;
      }[] = [];

      if (prevTurnId != null) {
        // Read previous turn + its turn_thread rows in one join.
        const prevRows = await trx
          .selectFrom('turn as t')
          .leftJoin('turn_thread as tt', join =>
            join.onRef('tt.session_id', '=', 't.session_id').onRef('tt.turn_id', '=', 't.turn_id'),
          )
          .leftJoin(
            db
              .selectFrom('turn_thread_context')
              .select(['thread_id', 'turn_id', sql<number>`MAX(pos)`.as('max_pos')])
              .where('session_id', '=', input.session_id)
              .where('turn_id', '=', prevTurnId)
              .groupBy(['thread_id', 'turn_id'])
              .as('tc_agg'),
            join => join.onRef('tc_agg.thread_id', '=', 'tt.thread_id').onRef('tc_agg.turn_id', '=', 'tt.turn_id'),
          )
          .select([
            jsonText<TurnCheckpoint>(sql.ref('t.checkpoint')).as('turn_checkpoint'),
            jsonText<TurnState>(sql.ref('t.state')).as('turn_state'),
            'tt.thread_id',
            jsonText<TurnThreadCheckpoint | null>(sql.ref('tt.checkpoint')).as('thread_checkpoint'),
            jsonText<AgentInfo | null>(sql.ref('tt.agent_info')).as('agent_info'),
            jsonText<CurrentContextUsage | null>(sql.ref('tt.current_context_usage')).as('current_context_usage'),
            'tc_agg.max_pos',
          ])
          .where('t.session_id', '=', input.session_id)
          .where('t.turn_id', '=', prevTurnId)
          .execute();

        const first = prevRows[0];
        if (first !== undefined) {
          if (first.turn_state.status === 'running') {
            throw new PreviousTurnRunningError(prevTurnId);
          }
          prevCheckpoint = first.turn_checkpoint;

          for (const row of prevRows) {
            if (row.thread_id === null) {
              continue;
            }
            if (row.thread_checkpoint === null || row.current_context_usage === null) {
              throw new SessionStoreInvariantError(`previous turn_thread row for ${row.thread_id} is incomplete`);
            }
            prevThreadRows.push({
              thread_id: row.thread_id,
              checkpoint: row.thread_checkpoint,
              agent_info: row.agent_info,
              current_context_usage: row.current_context_usage,
              context_pos_max: row.max_pos ?? 0,
            });
          }
        }
      }

      assertCreateTurnThreadDelta({
        previousThreadIds: new Set(prevThreadRows.map(r => r.thread_id)),
        new_threads: input.new_threads,
        new_context_appends: input.new_context_appends,
        capability_states: input.capability_states,
      });

      const checkpoint: TurnCheckpoint = {
        mcp_servers: input.mcp_servers ?? prevCheckpoint?.mcp_servers ?? null,
        sandbox_info: input.sandbox_info ?? prevCheckpoint?.sandbox_info ?? null,
      };

      const now = nowIso();

      const turnCustom = input.turn.custom ?? null;

      // Step 3: insert turn row.
      await trx
        .insertInto('turn')
        .values({
          session_id: input.session_id,
          turn_id: input.turn.turn_id,
          first_turn_id: input.turn.first_turn_id,
          previous_turn_id: input.turn.previous_turn_id ?? null,
          ancestor_ids: jsonbBind(input.turn.ancestor_ids),
          input: jsonbBind(input.turn.input),
          state: jsonbBind(input.turn.state),
          checkpoint: jsonbBind(checkpoint),
          custom: turnCustom !== null ? jsonbBind(turnCustom) : null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      // Step 4: insert new context log rows.
      const logRows: {
        session_id: string;
        thread_id: string;
        turn_id: string;
        body: RawBuilder<string>;
        created_at: string;
      }[] = [];

      for (const append of input.new_context_appends) {
        for (const body of append.context) {
          logRows.push({
            session_id: input.session_id,
            thread_id: append.thread_id,
            turn_id: input.turn.turn_id,
            body: jsonbBind(body),
            created_at: now,
          });
        }
      }

      const newIdsByThread = new Map<string, number[]>();
      if (logRows.length > 0) {
        const inserted = await trx
          .insertInto('thread_context_log')
          .values(logRows)
          .returning(['thread_id', 'append_id'])
          .execute();
        for (const row of sortedByAppendId(inserted)) {
          const list = newIdsByThread.get(row.thread_id);
          if (list === undefined) {
            newIdsByThread.set(row.thread_id, [row.append_id]);
          } else {
            list.push(row.append_id);
          }
        }
      }

      const appendUsageByThread = new Map<string, CurrentContextUsage>();
      for (const append of input.new_context_appends) {
        if (append.current_context_usage !== null) {
          appendUsageByThread.set(append.thread_id, append.current_context_usage);
        }
      }

      // Step 5: insert turn_thread rows for carried-forward and new threads.
      const turnThreadRows: {
        session_id: string;
        turn_id: string;
        thread_id: string;
        checkpoint: RawBuilder<string>;
        agent_info: RawBuilder<string> | null;
        current_context_usage: RawBuilder<string>;
        updated_at: string;
      }[] = [];

      const turnThreadContextRows: {
        session_id: string;
        turn_id: string;
        thread_id: string;
        pos: number;
        append_id: number;
      }[] = [];

      for (const parent of prevThreadRows) {
        const usage = appendUsageByThread.get(parent.thread_id) ?? parent.current_context_usage;
        turnThreadRows.push({
          session_id: input.session_id,
          turn_id: input.turn.turn_id,
          thread_id: parent.thread_id,
          checkpoint: jsonbBind(parent.checkpoint),
          agent_info: parent.agent_info !== null ? jsonbBind(parent.agent_info) : null,
          current_context_usage: jsonbBind(usage),
          updated_at: now,
        });
      }

      // One SELECT for all parent context mappings (not N+1 per thread).
      if (prevTurnId != null && prevThreadRows.length > 0) {
        const parentContextRows = await trx
          .selectFrom('turn_thread_context')
          .select(['thread_id', 'pos', 'append_id'])
          .where('session_id', '=', input.session_id)
          .where('turn_id', '=', prevTurnId)
          .where(
            'thread_id',
            'in',
            prevThreadRows.map(r => r.thread_id),
          )
          .orderBy('thread_id')
          .orderBy('pos')
          .execute();

        for (const cr of parentContextRows) {
          turnThreadContextRows.push({
            session_id: input.session_id,
            turn_id: input.turn.turn_id,
            thread_id: cr.thread_id,
            pos: cr.pos,
            append_id: cr.append_id,
          });
        }
      }

      for (const parent of prevThreadRows) {
        const newIds = newIdsByThread.get(parent.thread_id) ?? [];
        const basePos = parent.context_pos_max;
        for (let i = 0; i < newIds.length; i++) {
          const appendId = newIds[i];
          if (appendId !== undefined) {
            turnThreadContextRows.push({
              session_id: input.session_id,
              turn_id: input.turn.turn_id,
              thread_id: parent.thread_id,
              pos: basePos + i + 1,
              append_id: appendId,
            });
          }
        }
      }

      // Step 5b: new threads — fresh turn_thread + mapping rows.
      for (const nt of input.new_threads) {
        const newIds = newIdsByThread.get(nt.thread_id) ?? [];
        const usage = appendUsageByThread.get(nt.thread_id) ?? getEmptyCurrentContextUsage();
        const threadCheckpoint: TurnThreadCheckpoint = {
          parent: nt.parent,
          completion: null,
        };
        turnThreadRows.push({
          session_id: input.session_id,
          turn_id: input.turn.turn_id,
          thread_id: nt.thread_id,
          checkpoint: jsonbBind(threadCheckpoint),
          agent_info: nt.agent_info !== null ? jsonbBind(nt.agent_info) : null,
          current_context_usage: jsonbBind(usage),
          updated_at: now,
        });

        for (let i = 0; i < newIds.length; i++) {
          const appendId = newIds[i];
          if (appendId !== undefined) {
            turnThreadContextRows.push({
              session_id: input.session_id,
              turn_id: input.turn.turn_id,
              thread_id: nt.thread_id,
              pos: i + 1,
              append_id: appendId,
            });
          }
        }
      }

      if (turnThreadRows.length > 0) {
        await trx.insertInto('turn_thread').values(turnThreadRows).execute();
      }

      if (turnThreadContextRows.length > 0) {
        await trx.insertInto('turn_thread_context').values(turnThreadContextRows).execute();
      }

      // Step 6: insert capability state rows (thread coverage asserted above).
      const capabilityStateRows: {
        session_id: string;
        turn_id: string;
        thread_id: string;
        key: string;
        state: RawBuilder<string> | null;
        updated_at: string;
      }[] = [];

      for (const capability of input.capability_states) {
        if (capability.capability_state === null) {
          continue;
        }
        for (const [key, state] of Object.entries(capability.capability_state)) {
          capabilityStateRows.push({
            session_id: input.session_id,
            turn_id: input.turn.turn_id,
            thread_id: capability.thread_id,
            key,
            state: state !== null ? jsonbBind(state) : null,
            updated_at: now,
          });
        }
      }

      if (capabilityStateRows.length > 0) {
        await trx.insertInto('thread_capability_state').values(capabilityStateRows).execute();
      }
    });
  } catch (err) {
    if (err instanceof SessionStoreNotFoundError || err instanceof SessionStoreConflictError) {
      throw err;
    }
    if (isUniqueViolation(err)) {
      throw new TurnAlreadyExistsError(input.turn.turn_id, { cause: err });
    }
    throw err;
  }
}

/**
 * freezeAndGetTurn — cancel if still running, then return the assembled record.
 * Terminal turns are returned unchanged (freeze is a plain read).
 */
export async function freezeAndGetTurn(db: Kysely<Database>, input: FreezeAndGetTurnInput): Promise<TurnRecord> {
  return await db.transaction().execute(async trx => {
    const cancelledState: TerminalTurnState = {
      status: 'cancelled',
      reason: input.reason,
      completed_at: nowIso(),
    };

    const updateResult = await trx
      .updateTable('turn')
      .set({
        state: jsonbBind(cancelledState),
        updated_at: nowIso(),
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .executeTakeFirst();

    if (Number(updateResult.numUpdatedRows) > 0) {
      await trx
        .insertInto('session_event')
        .values({
          session_id: input.session_id,
          turn_id: input.turn_id,
          event_id: input.turn_done_event.id,
          event: jsonbBind(input.turn_done_event),
          created_at: input.turn_done_event.created_at,
        })
        .execute();
    }

    const record = await assembleTurnRecord(trx, input);
    if (!record) {
      throw new TurnNotFoundError(input.turn_id);
    }
    return record;
  });
}

/**
 * getTurn — deferred read tx so assembleTurnRecord's SELECTs share one snapshot.
 * ImmediateSqliteDriver maps setAccessMode('read only') → BEGIN (not IMMEDIATE).
 */
export async function getTurn(db: Kysely<Database>, input: GetTurnInput): Promise<TurnRecord<TurnCustom> | undefined> {
  return db
    .transaction()
    .setAccessMode('read only')
    .execute(trx => assembleTurnRecord(trx, input));
}

/**
 * listTurns — ORDER BY created_at, turn_id; LIMIT limit+1 OFFSET offset.
 * Returns turn rows only (no snapshot assembly); use getTurn for full TurnRecord.
 */
export async function listTurns(db: Kysely<Database>, input: ListTurnsInput): Promise<ListTurnsResult> {
  const rows = await db
    .selectFrom('turn')
    .select([
      'session_id',
      'turn_id',
      'first_turn_id',
      'previous_turn_id',
      jsonText<string[]>(sql.ref('ancestor_ids')).as('ancestor_ids'),
      jsonText<TurnInputItem[]>(sql.ref('input')).as('input'),
      jsonText<TurnState>(sql.ref('state')).as('state'),
      jsonText<Record<string, unknown> | null>(sql.ref('custom')).as('custom'),
      'created_at',
      'updated_at',
    ])
    .where('session_id', '=', input.session_id)
    .orderBy('created_at', 'asc')
    .orderBy('turn_id', 'asc')
    .limit(input.limit + 1)
    .offset(input.offset)
    .execute();

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const turns: TurnRecordWithoutSnapshot<TurnCustom>[] = page.map(row => ({
    turn_id: row.turn_id,
    session_id: row.session_id,
    first_turn_id: row.first_turn_id,
    ancestor_ids: row.ancestor_ids,
    previous_turn_id: row.previous_turn_id,
    state: row.state,
    input: row.input,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    custom: parseTurnCustom(row.custom),
  }));

  return {
    turns,
    next_offset: hasMore ? input.offset + input.limit : null,
  };
}

/**
 * updateTurnState — conditional on state->>'status'='running'.
 * 0 rows → SELECT by PK → missing NotFound, present Conflict (first terminal write wins).
 */
export async function updateTurnState(db: Kysely<Database>, input: UpdateTurnStateInput): Promise<void> {
  await db.transaction().execute(async trx => {
    const result = await trx
      .updateTable('turn')
      .set({
        state: jsonbBind(input.state),
        updated_at: nowIso(),
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .executeTakeFirst();

    const numUpdated = Number(result.numUpdatedRows);
    if (numUpdated === 0) {
      const existing = await trx
        .selectFrom('turn')
        .select([jsonText<TurnState>(sql.ref('state')).as('state')])
        .where('session_id', '=', input.session_id)
        .where('turn_id', '=', input.turn_id)
        .executeTakeFirst();

      if (!existing) {
        throw new TurnNotFoundError(input.turn_id);
      }
      throw new TurnNotRunningError(input.turn_id, terminalTurnState(existing.state, input.turn_id));
    }

    await trx
      .insertInto('session_event')
      .values({
        session_id: input.session_id,
        turn_id: input.turn_id,
        event_id: input.turn_done_event.id,
        event: jsonbBind(input.turn_done_event),
        created_at: input.turn_done_event.created_at,
      })
      .execute();
  });
}
