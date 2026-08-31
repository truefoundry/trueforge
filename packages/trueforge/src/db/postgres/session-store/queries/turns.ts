import type { SessionMetrics } from '@truefoundry/trueforge-core/agent-session';
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
import { sql, type Kysely, type QueryCreator, type RawBuilder, type Transaction } from 'kysely';
import { isUniqueViolation } from '../../client';
import { json, jsonbSet } from '../../sqlExpressions';
import type { Database, TurnCheckpoint, TurnThreadCheckpoint } from '../../types';
import { lateralUnnestBigintArrayWithOrdinality } from '../sqlExpressions';

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
type TurnFenceDb = DbOrTrx | QueryCreator<Database>;

function incrementSessionTotalTurns(): RawBuilder<SessionMetrics> {
  return jsonbSet<SessionMetrics>(
    sql`metrics`,
    sql`'{total_turns}'`,
    sql`to_jsonb((metrics->>'total_turns')::int + 1)`,
  );
}

/** Same tx as the turn flip; the session row lock serializes concurrent terminal folds. */
async function addSessionCostAndDuration(
  trx: Transaction<Database>,
  input: { session_id: string; turn_created_at: Date; turn_state: TerminalTurnState },
): Promise<void> {
  const elapsed_ms = Date.parse(input.turn_state.completed_at) - input.turn_created_at.getTime();
  const total_cost_in_usd = input.turn_state.metrics?.total_cost_in_usd ?? 0;
  const total_duration_ms = elapsed_ms > 0 ? Math.trunc(elapsed_ms) : 0;
  await trx
    .updateTable('session')
    .set({
      metrics: jsonbSet<SessionMetrics>(
        jsonbSet(
          sql`metrics`,
          sql`'{total_cost_in_usd}'`,
          sql`to_jsonb((metrics->>'total_cost_in_usd')::double precision + ${total_cost_in_usd}::double precision)`,
        ),
        // bigint: ::int overflows at ~24.8 days of summed ms and would roll back the terminal tx.
        sql`'{total_duration_ms}'`,
        sql`to_jsonb((metrics->>'total_duration_ms')::bigint + ${total_duration_ms}::bigint)`,
      ),
    })
    .where('session_id', '=', input.session_id)
    .execute();
}

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

/**
 * Locking CTE body for single-statement turn-scoped writes: fence + write in one
 * network call. Under READ COMMITTED, FOR SHARE re-checks the predicate after a
 * lock wait, so a committed freeze empties the fence and the write inserts 0 rows;
 * error classification happens on that rare 0-row path.
 * Multi-statement turn-scoped writes use {@link assertTurnRunning} instead.
 */
export function turnRunningFence(db: TurnFenceDb, keys: TurnKeys) {
  return db
    .selectFrom('turn')
    .select(sql`1`.as('one'))
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where(sql`state->>'status'`, '=', 'running')
    .forShare();
}

/** Classify a 0-row fenced write: missing turn vs frozen/non-running turn. */
export async function classifyTurnFenceWriteFailure(db: Kysely<Database>, keys: TurnKeys): Promise<never> {
  const row = await db
    .selectFrom('turn')
    .select('state')
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .executeTakeFirst();

  if (!row) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  throw new TurnNotRunningError(keys.turn_id, terminalTurnState(row.state, keys.turn_id));
}

/**
 * Classify a 0-row fenced turn_thread UPDATE: turn missing/terminal vs thread row missing.
 */
export async function classifyTurnThreadWriteFailure(
  db: Kysely<Database>,
  keys: TurnKeys,
  thread_id: string,
): Promise<never> {
  const row = await db
    .selectFrom('turn')
    .select('state')
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .executeTakeFirst();

  if (!row) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  if (row.state.status !== 'running') {
    throw new TurnNotRunningError(keys.turn_id, terminalTurnState(row.state, keys.turn_id));
  }
  throw new SessionStoreInvariantError(`thread ${thread_id} not found in turn ${keys.turn_id}`);
}

export async function assertTurnRunning(db: DbOrTrx, keys: TurnKeys): Promise<void> {
  // SELECT ... FOR SHARE serializes against freezeAndGetTurn's state UPDATE.
  const row = await db
    .selectFrom('turn')
    .select('state')
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .forShare()
    .executeTakeFirst();

  if (!row) {
    throw new TurnNotFoundError(keys.turn_id);
  }
  if (row.state.status !== 'running') {
    throw new TurnNotRunningError(keys.turn_id, terminalTurnState(row.state, keys.turn_id));
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
    .selectAll()
    .where('session_id', '=', args.session_id)
    .where('turn_id', '=', args.turn_id)
    .executeTakeFirst();

  if (!turn) {
    return undefined;
  }

  // LEFT JOIN LATERAL unnest so empty-context threads still appear; LEFT JOIN log
  // because a null lateral append_id (empty array) must not drop the turn_thread row.
  const contextRows = await db
    .selectFrom('turn_thread as tt')
    .leftJoin(lateralUnnestBigintArrayWithOrdinality(sql<number[]>`tt.context_ids`, 'c'), join => join.onTrue())
    .leftJoin('thread_context_log as l', join =>
      join
        .on('l.session_id', '=', args.session_id)
        .onRef('l.thread_id', '=', 'tt.thread_id')
        .onRef('l.append_id', '=', 'c.append_id'),
    )
    .select(['tt.thread_id', 'tt.checkpoint', 'tt.agent_info', 'tt.current_context_usage', 'l.body', 'c.pos'])
    .where('tt.session_id', '=', args.session_id)
    .where('tt.turn_id', '=', args.turn_id)
    .orderBy('tt.thread_id')
    .orderBy('c.pos')
    .execute();

  const capabilityRows: CapabilityAggRow[] = await db
    .selectFrom('thread_capability_state')
    .select(['thread_id', sql<Record<string, JsonValue> | null>`jsonb_object_agg(key, state)`.as('capability_state')])
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

  const checkpoint: TurnCheckpoint = turn.checkpoint;
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
    created_at: turn.created_at,
    updated_at: turn.updated_at,
    custom: parseTurnCustom(turn.custom),
  };
}

interface TurnInsertValues {
  session_id: string;
  turn_id: string;
  first_turn_id: string;
  previous_turn_id: string | null;
  ancestor_ids: string[];
  input: RawBuilder<CreateTurnInput['turn']['input']>;
  state: CreateTurnInput['turn']['state'];
  checkpoint: TurnCheckpoint;
  custom: RawBuilder<Record<string, unknown>> | null;
  created_at: Date;
  updated_at: Date;
}

interface LogInsertRow {
  session_id: string;
  thread_id: string;
  turn_id: string;
  body: RawBuilder<ContextMessage>;
  created_at: Date;
}

interface TurnThreadInsertRow {
  session_id: string;
  turn_id: string;
  thread_id: string;
  checkpoint: TurnThreadCheckpoint;
  agent_info: RawBuilder<AgentInfo> | null;
  current_context_usage: CurrentContextUsage;
  context_ids: number[];
  updated_at: Date;
}

interface CapabilityStateInsertRow {
  session_id: string;
  turn_id: string;
  thread_id: string;
  key: string;
  state: RawBuilder<JsonValue>;
  updated_at: Date;
}

/**
 * createTurn — READ COMMITTED tx. Fork and linear are THE SAME pointer-copy path:
 * child turn_thread rows copy the parent's arrays and concat new append ids.
 * Tip bump uses SELECT ... FOR UPDATE then UPDATE (safe on PG17; the one-statement
 * CTE tip-bump is PROVEN UNSAFE under EvalPlanQual — a blocked second writer gets
 * the stale pre-commit tip because the CTE keeps the statement snapshot).
 */
export async function createTurn(db: Kysely<Database>, input: CreateTurnInput): Promise<void> {
  try {
    await db.transaction().execute(async trx => {
      // step1: lock session tip, bump. Two statements on purpose — see PROVEN-UNSAFE-CTE note above.
      const locked = await trx
        .selectFrom('session')
        .select(['last_turn_id'])
        .where('session_id', '=', input.session_id)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) {
        throw new SessionNotFoundError(input.session_id);
      }

      await trx
        .updateTable('session')
        .set({
          last_turn_id: input.turn.turn_id,
          updated_at: sql`now()`,
          last_activity_timestamp_ms: input.last_activity_timestamp_ms,
          // total_turns rides the same tip UPDATE so a later failure in this tx rolls it back.
          metrics: incrementSessionTotalTurns(),
          ...(input.update_session_title_if_not_exist !== null
            ? {
                title: sql`COALESCE(title, ${input.update_session_title_if_not_exist})`,
              }
            : {}),
        })
        .where('session_id', '=', input.session_id)
        .execute();

      const prevTurnId = input.turn.previous_turn_id;

      // step2: previous turn state + its turn_thread rows (pointer-copy source).
      let prevCheckpoint: TurnCheckpoint | null = null;
      const prevThreadRows: {
        thread_id: string;
        checkpoint: TurnThreadCheckpoint;
        agent_info: AgentInfo | null;
        current_context_usage: CurrentContextUsage;
        context_ids: number[];
      }[] = [];

      if (prevTurnId != null) {
        // One round-trip: previous turn metadata + its turn_thread rows.
        // Unknown previous_turn_id is allowed (relaxed): treat as no inheritance.
        const prevRows = await trx
          .selectFrom('turn as t')
          .leftJoin('turn_thread as tt', join =>
            join.onRef('tt.session_id', '=', 't.session_id').onRef('tt.turn_id', '=', 't.turn_id'),
          )
          .select([
            't.checkpoint as turn_checkpoint',
            't.state as turn_state',
            'tt.thread_id',
            'tt.checkpoint as thread_checkpoint',
            'tt.agent_info',
            'tt.current_context_usage',
            'tt.context_ids',
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
            if (row.thread_checkpoint === null || row.current_context_usage === null || row.context_ids === null) {
              throw new SessionStoreInvariantError(`previous turn_thread row for ${row.thread_id} is incomplete`);
            }
            prevThreadRows.push({
              thread_id: row.thread_id,
              checkpoint: row.thread_checkpoint,
              agent_info: row.agent_info,
              current_context_usage: row.current_context_usage,
              context_ids: row.context_ids,
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

      const now = new Date();

      const turnCustom = input.turn.custom ?? null;

      // step3: turn row
      const turnValues: TurnInsertValues = {
        session_id: input.session_id,
        turn_id: input.turn.turn_id,
        first_turn_id: input.turn.first_turn_id,
        previous_turn_id: input.turn.previous_turn_id ?? null,
        ancestor_ids: input.turn.ancestor_ids,
        input: json(input.turn.input),
        state: input.turn.state,
        checkpoint,
        custom: turnCustom !== null ? json(turnCustom) : null,
        created_at: now,
        updated_at: now,
      };
      await trx.insertInto('turn').values(turnValues).execute();

      // step4: new_context_appends bodies; RETURNING feeds the arrays app-side.
      const logRows: LogInsertRow[] = [];
      for (const append of input.new_context_appends) {
        for (const body of append.context) {
          logRows.push({
            session_id: input.session_id,
            thread_id: append.thread_id,
            turn_id: input.turn.turn_id,
            body: json(body),
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
        for (const row of inserted) {
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

      // step5: child turn_thread rows — carried = parent || new ids; new = fresh row.
      const turnThreadRows: TurnThreadInsertRow[] = [];

      for (const parent of prevThreadRows) {
        const newIds = newIdsByThread.get(parent.thread_id) ?? [];
        const usage = appendUsageByThread.get(parent.thread_id) ?? parent.current_context_usage;
        turnThreadRows.push({
          session_id: input.session_id,
          turn_id: input.turn.turn_id,
          thread_id: parent.thread_id,
          checkpoint: parent.checkpoint,
          agent_info: parent.agent_info !== null ? json(parent.agent_info) : null,
          current_context_usage: usage,
          context_ids: parent.context_ids.concat(newIds),
          updated_at: now,
        });
      }

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
          checkpoint: threadCheckpoint,
          agent_info: nt.agent_info !== null ? json(nt.agent_info) : null,
          current_context_usage: usage,
          context_ids: newIds,
          updated_at: now,
        });
      }

      if (turnThreadRows.length > 0) {
        await trx.insertInto('turn_thread').values(turnThreadRows).execute();
      }

      // Complete per-turn capability maps (thread coverage asserted above).
      const capabilityStateRows: CapabilityStateInsertRow[] = [];
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
            state: json(state),
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
 * freezeAndGetTurn — cancel if still running (fencing future writes), then return the record.
 * Terminal turns are returned unchanged (freeze is a plain read).
 */
export async function freezeAndGetTurn(db: Kysely<Database>, input: FreezeAndGetTurnInput): Promise<TurnRecord> {
  return await db.transaction().execute(async trx => {
    const cancelledState: TerminalTurnState = {
      status: 'cancelled',
      reason: input.reason,
      completed_at: new Date().toISOString(),
    };

    // UPDATE waits for in-flight turn-scoped writes (FOR SHARE on this row) to
    // commit; assembly below then includes every committed straggler.
    const updateResult = await trx
      .updateTable('turn')
      .set({
        state: cancelledState,
        updated_at: sql`now()`,
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .returning(['created_at'])
      .executeTakeFirst();

    if (updateResult !== undefined) {
      await trx
        .insertInto('session_event')
        .values({
          session_id: input.session_id,
          turn_id: input.turn_id,
          event_id: input.turn_done_event.id,
          event: json(input.turn_done_event),
          created_at: new Date(input.turn_done_event.created_at),
        })
        .execute();
      // Only the winning cancel folds; a freeze of an already-terminal turn is a read.
      await addSessionCostAndDuration(trx, {
        session_id: input.session_id,
        turn_created_at: updateResult.created_at,
        turn_state: cancelledState,
      });
    }

    const record = await assembleTurnRecord(trx, input);
    if (!record) {
      throw new TurnNotFoundError(input.turn_id);
    }
    return record;
  });
}

/**
 * getTurn — read-only REPEATABLE READ tx.
 * Concurrent appends after the first SELECT are invisible to later SELECTs in the same tx.
 */
export async function getTurn(db: Kysely<Database>, input: GetTurnInput): Promise<TurnRecord<TurnCustom> | undefined> {
  return await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async trx => {
      return assembleTurnRecord(trx, input);
    });
}

/**
 * listTurns — ORDER BY created_at, turn_id; LIMIT limit+1 OFFSET offset; numeric-offset tokens.
 * Returns turn rows only (no snapshot assembly); use getTurn for full TurnRecord.
 */
export async function listTurns(db: Kysely<Database>, input: ListTurnsInput): Promise<ListTurnsResult> {
  const rows = await db
    .selectFrom('turn')
    .selectAll()
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
    created_at: row.created_at,
    updated_at: row.updated_at,
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
        state: input.state,
        updated_at: sql`now()`,
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .returning(['created_at'])
      .executeTakeFirst();

    // No RETURNING row: UPDATE matched 0 running turns.
    if (result === undefined) {
      const existing = await trx
        .selectFrom('turn')
        .select('state')
        .where('session_id', '=', input.session_id)
        .where('turn_id', '=', input.turn_id)
        .executeTakeFirst();

      if (!existing) {
        throw new TurnNotFoundError(input.turn_id);
      }
      throw new TurnNotRunningError(input.turn_id, terminalTurnState(existing.state, input.turn_id));
    }

    await addSessionCostAndDuration(trx, {
      session_id: input.session_id,
      turn_created_at: result.created_at,
      turn_state: input.state,
    });

    await trx
      .insertInto('session_event')
      .values({
        session_id: input.session_id,
        turn_id: input.turn_id,
        event_id: input.turn_done_event.id,
        event: json(input.turn_done_event),
        created_at: new Date(input.turn_done_event.created_at),
      })
      .execute();
  });
}
