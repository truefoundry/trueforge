import type { AgentThreadSnapshot } from '../../core/runtime/AgentThread.types';
import { getEmptyCurrentContextUsage } from '../../core/runtime/contextUsage';
import type { SessionRecord } from '../models/SessionRecord';
import type { TurnRecord, TurnSnapshot } from '../models/TurnRecord';
import type { PersistedTurnEvent, SessionEventItem } from '../schemas/events';
import type { TokenPagination } from '../schemas/pagination';
import type { TerminalTurnState } from '../schemas/turn';
import { assertCreateTurnThreadDelta } from './assertCreateTurnThreadDelta';
import type {
  AddThreadsInput,
  AppendToEventsInput,
  AppendToThreadContextInput,
  CreateSessionInput,
  CreateTurnInput,
  DeleteSessionInput,
  FreezeAndGetTurnInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  GetTurnInput,
  ISessionStore,
  ListSessionEventsInput,
  ListSessionsInput,
  ListTurnEventsInput,
  ListTurnsInput,
  NewThreadInit,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  PatchThreadCapabilityStateInput,
  RemoveThreadsInput,
  TurnContextAppend,
  TurnRecordWithoutSnapshot,
  UpdateSessionInput,
  UpdateTurnStateInput,
} from './ISessionStore';
import { decodeOffsetPageToken, encodeOffsetPageToken } from './OffsetPageToken';
import {
  decodeSessionEventPageToken,
  paginateSessionEventRows,
  type SessionEventPageCursor,
} from './SessionEventPageToken';
import { decodeSessionListPageToken, paginateSessionListRows } from './SessionListPageToken';
import {
  PreviousTurnRunningError,
  SessionAlreadyExistsError,
  SessionExternalIdConflictError,
  SessionNotFoundError,
  SessionStoreInvariantError,
  TurnAlreadyExistsError,
  TurnNotFoundError,
  TurnNotRunningError,
} from './SessionStoreErrors';

/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async so thrown SessionStore*Error reject as Promises for ISessionStore callers */

type StoredEvent = PersistedTurnEvent;

interface StoredSession<TSessionCustom extends object> {
  record: SessionRecord<TSessionCustom>;
  turnIds: string[];
}

function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function sessionKey(sessionId: string): string {
  return sessionId;
}

function turnKey({ session_id, turn_id }: { session_id: string; turn_id: string }): string {
  return `${session_id}:${turn_id}`;
}

/** Lexicographic session_id order — shared by listSessions sort and keyset filter. */
function compareSessionId(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function newThreadSnapshot(thread: NewThreadInit): AgentThreadSnapshot {
  return {
    thread_id: thread.thread_id,
    parent: thread.parent ?? null,
    agent_info: thread.agent_info ?? null,
    capability_state: null,
    context: [],
    current_context_usage: getEmptyCurrentContextUsage(),
    completion: null,
  };
}

function applyContextAppends(threads: Record<string, AgentThreadSnapshot>, appends: TurnContextAppend[]): void {
  for (const append of appends) {
    const thread = threads[append.thread_id];
    if (!thread) {
      throw new SessionStoreInvariantError(`new_context_appends references unknown thread ${append.thread_id}`);
    }
    thread.context.push(...deepCopy(append.context));
    if (append.current_context_usage !== null) {
      thread.current_context_usage = deepCopy(append.current_context_usage);
    }
  }
}

function buildSnapshotFromDelta(input: {
  previousSnapshot: TurnSnapshot | undefined;
  new_threads: NewThreadInit[];
  new_context_appends: TurnContextAppend[];
  capability_states: CreateTurnInput['capability_states'];
}): TurnSnapshot {
  const threads: Record<string, AgentThreadSnapshot> = input.previousSnapshot
    ? deepCopy(input.previousSnapshot.threads)
    : {};

  assertCreateTurnThreadDelta({
    previousThreadIds: new Set(Object.keys(threads)),
    new_threads: input.new_threads,
    new_context_appends: input.new_context_appends,
    capability_states: input.capability_states,
  });

  for (const nt of input.new_threads) {
    threads[nt.thread_id] = newThreadSnapshot(nt);
  }

  applyContextAppends(threads, input.new_context_appends);
  for (const capability of input.capability_states) {
    const thread = threads[capability.thread_id];
    if (thread === undefined) {
      throw new SessionStoreInvariantError(`capability_states references unknown thread ${capability.thread_id}`);
    }
    thread.capability_state = deepCopy(capability.capability_state);
  }

  return {
    threads,
    mcp_servers: input.previousSnapshot ? deepCopy(input.previousSnapshot.mcp_servers) : null,
    sandbox_info: input.previousSnapshot ? deepCopy(input.previousSnapshot.sandbox_info) : null,
  };
}

function paginate<T>(items: T[], limit: number, pageToken?: string): { data: T[]; pagination: TokenPagination } {
  const offset = decodeOffsetPageToken(pageToken);
  const slice = items.slice(offset, offset + limit);
  return {
    data: slice,
    pagination: {
      limit,
      ...(offset + limit < items.length ? { next_page_token: encodeOffsetPageToken(offset + limit) } : {}),
      ...(offset > 0 ? { previous_page_token: encodeOffsetPageToken(Math.max(0, offset - limit)) } : {}),
    },
  };
}

/**
 * Reference ISessionStore implementation. Proves the contract without SSE/subscription
 * hooks. Deep-copies on read/write boundaries so callers cannot mutate stored state.
 */
export class InMemorySessionStore<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> implements ISessionStore<TSessionCustom, TTurnCustom> {
  private readonly sessions = new Map<string, StoredSession<TSessionCustom>>();
  private readonly turns = new Map<string, TurnRecord<TTurnCustom>>();
  private readonly events = new Map<string, StoredEvent[]>();

  async createSession(input: CreateSessionInput<TSessionCustom>): Promise<void> {
    const key = sessionKey(input.session_id);
    if (this.sessions.has(key)) {
      throw new SessionAlreadyExistsError(input.session_id);
    }
    const externalId = input.external_id;
    if (externalId !== null) {
      for (const stored of this.sessions.values()) {
        if (stored.record.tenant_id === input.tenant_id && stored.record.external_id === externalId) {
          throw new SessionExternalIdConflictError(externalId);
        }
      }
    }
    const now = new Date();
    const record: SessionRecord<TSessionCustom> = {
      tenant_id: input.tenant_id,
      session_id: input.session_id,
      created_by_subject: input.created_by_subject,
      agent: deepCopy(input.agent),
      title: null,
      last_turn_id: null,
      external_id: externalId,
      source: input.source !== null ? deepCopy(input.source) : null,
      created_at: now,
      updated_at: now,
      last_activity_timestamp_ms: Date.now(),
      metrics: {
        total_cost_in_usd: 0,
        total_duration_ms: 0,
        total_turns: 0,
      },
      metadata: deepCopy(input.metadata),
      custom: input.custom !== null ? deepCopy(input.custom) : null,
    };
    this.sessions.set(key, { record, turnIds: [] });
    return;
  }

  async deleteSession(input: DeleteSessionInput): Promise<void> {
    const sKey = sessionKey(input.session_id);
    const stored = this.sessions.get(sKey);
    if (stored?.record.tenant_id !== input.tenant_id) {
      return;
    }
    for (const turnId of stored.turnIds) {
      const tKey = turnKey({ session_id: input.session_id, turn_id: turnId });
      this.turns.delete(tKey);
      this.events.delete(tKey);
    }
    this.sessions.delete(sKey);
  }

  async getSession(input: GetSessionInput): Promise<SessionRecord<TSessionCustom> | undefined> {
    const stored = this.sessions.get(sessionKey(input.session_id));
    return stored?.record.tenant_id === input.tenant_id ? deepCopy(stored.record) : undefined;
  }

  async getSessionByExternalId(input: GetSessionByExternalIdInput): Promise<SessionRecord<TSessionCustom> | undefined> {
    for (const stored of this.sessions.values()) {
      if (stored.record.tenant_id === input.tenant_id && stored.record.external_id === input.external_id) {
        return deepCopy(stored.record);
      }
    }
    return undefined;
  }

  async updateSession(input: UpdateSessionInput<TSessionCustom>): Promise<void> {
    const key = sessionKey(input.session_id);
    const stored = this.sessions.get(key);
    if (stored?.record.tenant_id !== input.tenant_id) {
      throw new SessionNotFoundError(input.session_id);
    }
    if (input.agent !== undefined) {
      if (stored.record.agent.type === 'reference') {
        throw new SessionStoreInvariantError(`Session ${input.session_id} is named; agent cannot be updated`);
      }
      stored.record.agent = deepCopy(input.agent);
    }
    if (input.title !== undefined) {
      stored.record.title = input.title;
    }
    if (input.metadata !== undefined) {
      stored.record.metadata = deepCopy(input.metadata);
    }
    const now = Date.now();
    stored.record.updated_at = new Date(now);
    stored.record.last_activity_timestamp_ms = now;
    return;
  }

  async listSessions(
    input: ListSessionsInput,
  ): Promise<{ data: SessionRecord<TSessionCustom>[]; pagination: TokenPagination }> {
    const records: SessionRecord<TSessionCustom>[] = [];
    for (const stored of this.sessions.values()) {
      if (stored.record.tenant_id !== input.tenant_id) {
        continue;
      }
      if (
        input.agent_id !== undefined &&
        (stored.record.agent.type !== 'reference' || stored.record.agent.id !== input.agent_id)
      ) {
        continue;
      }
      if (
        input.created_by_subject_id !== undefined &&
        stored.record.created_by_subject.subject_id !== input.created_by_subject_id
      ) {
        continue;
      }
      if (input.source_type !== undefined && stored.record.source?.type !== input.source_type) {
        continue;
      }
      if (input.source_id !== undefined && stored.record.source?.id !== input.source_id) {
        continue;
      }
      const createdAt = stored.record.created_at.getTime();
      if (input.start_timestamp !== undefined && createdAt < input.start_timestamp.getTime()) {
        continue;
      }
      if (input.end_timestamp !== undefined && createdAt > input.end_timestamp.getTime()) {
        continue;
      }
      records.push(stored.record);
    }
    records.sort((a, b) => {
      const aTime = a.updated_at.getTime();
      const bTime = b.updated_at.getTime();
      if (aTime !== bTime) {
        return input.order === 'asc' ? aTime - bTime : bTime - aTime;
      }
      // Same lexicographic order as the keyset predicate below (and Postgres/SQLite).
      return input.order === 'asc'
        ? compareSessionId(a.session_id, b.session_id)
        : compareSessionId(b.session_id, a.session_id);
    });

    let filtered = records;
    const cursor = decodeSessionListPageToken(input.page_token);
    if (cursor) {
      const cursorTime = new Date(cursor.updated_at).getTime();
      filtered = records.filter(record => {
        const t = record.updated_at.getTime();
        const idCmp = compareSessionId(record.session_id, cursor.session_id);
        if (input.order === 'asc') {
          return t > cursorTime || (t === cursorTime && idCmp > 0);
        }
        return t < cursorTime || (t === cursorTime && idCmp < 0);
      });
    }

    const page = paginateSessionListRows(filtered, input.limit, row => row.updated_at.toISOString());
    return { data: deepCopy(page.data), pagination: page.pagination };
  }

  async createTurn(input: CreateTurnInput<TTurnCustom>): Promise<void> {
    // Atomicity is free here: this body is fully synchronous, so Node's
    // run-to-completion guarantees it. Real backends must still use their own
    // locking/transactions to satisfy the ISessionStore createTurn contract.
    const sKey = sessionKey(input.turn.session_id);
    const stored = this.sessions.get(sKey);
    if (!stored) {
      throw new SessionNotFoundError(input.turn.session_id);
    }

    const previousTurnId = input.turn.previous_turn_id;
    let previousSnapshot: TurnSnapshot | undefined;
    if (previousTurnId !== null) {
      const prevKey = turnKey({ session_id: input.turn.session_id, turn_id: previousTurnId });
      const prev = this.turns.get(prevKey);
      // Unknown previous_turn_id is allowed (relaxed): treat as no inheritance.
      // A still-running previous must be frozen first.
      if (prev !== undefined) {
        if (prev.state.status === 'running') {
          throw new PreviousTurnRunningError(previousTurnId);
        }
        previousSnapshot = prev.snapshot;
      }
    }

    const tKey = turnKey(input.turn);
    if (this.turns.has(tKey)) {
      throw new TurnAlreadyExistsError(input.turn.turn_id);
    }

    const snapshot = buildSnapshotFromDelta({
      previousSnapshot,
      new_threads: input.new_threads,
      new_context_appends: input.new_context_appends,
      capability_states: input.capability_states,
    });

    const turnRecord: TurnRecord<TTurnCustom> = {
      ...deepCopy(input.turn),
      snapshot,
    };

    this.turns.set(tKey, turnRecord);
    this.events.set(tKey, []);
    stored.turnIds.push(input.turn.turn_id);
    stored.record.last_turn_id = input.turn.turn_id;
    stored.record.metrics.total_turns += 1;
    stored.record.last_activity_timestamp_ms = Date.now();
    stored.record.updated_at = new Date();
    if (input.update_session_title_if_not_exist !== null && stored.record.title === null) {
      stored.record.title = input.update_session_title_if_not_exist;
    }
  }

  async freezeAndGetTurn(input: FreezeAndGetTurnInput): Promise<TurnRecord<TTurnCustom>> {
    const tKey = turnKey(input);
    const turn = this.requireTurn(input.session_id, input.turn_id);

    if (turn.state.status === 'running') {
      const cancelledState: TerminalTurnState = {
        status: 'cancelled',
        reason: input.reason,
        completed_at: new Date().toISOString(),
      };
      turn.state = cancelledState;
      turn.updated_at = new Date();
      const list = this.events.get(tKey);
      if (list) {
        list.push(deepCopy(input.turn_done_event));
      }
      this.addTerminalSessionMetrics(input.session_id, turn.created_at, cancelledState);
    }

    return deepCopy(turn);
  }

  async getTurn(input: GetTurnInput): Promise<TurnRecord<TTurnCustom> | undefined> {
    const turn = this.turns.get(turnKey(input));
    return turn ? deepCopy(turn) : undefined;
  }

  async listTurns(
    input: ListTurnsInput,
  ): Promise<{ data: TurnRecordWithoutSnapshot<TTurnCustom>[]; pagination: TokenPagination }> {
    const stored = this.sessions.get(sessionKey(input.session_id));
    if (!stored) {
      throw new SessionNotFoundError(input.session_id);
    }
    const records = stored.turnIds.map(id => {
      const turn = this.turns.get(turnKey({ session_id: input.session_id, turn_id: id }));
      if (!turn) {
        throw new TurnNotFoundError(id);
      }
      const { snapshot, ...row } = deepCopy(turn);
      void snapshot;
      return row;
    });
    return paginate(records, input.limit, input.page_token);
  }

  async updateTurnState(input: UpdateTurnStateInput): Promise<void> {
    // Same as createTurn: synchronous body ⇒ atomic under run-to-completion.
    const tKey = turnKey(input);
    const turn = this.requireTurn(input.session_id, input.turn_id);
    if (turn.state.status !== 'running') {
      throw new TurnNotRunningError(input.turn_id, turn.state);
    }
    turn.state = deepCopy(input.state);
    turn.updated_at = new Date();
    const list = this.events.get(tKey);
    if (list) {
      list.push(deepCopy(input.turn_done_event));
    }
    this.addTerminalSessionMetrics(input.session_id, turn.created_at, input.state);
  }

  async appendToEvents(input: AppendToEventsInput): Promise<void> {
    this.requireRunningTurn(input.session_id, input.turn_id);
    const tKey = turnKey(input);
    const list = this.events.get(tKey);
    if (!list) {
      throw new TurnNotFoundError(input.turn_id);
    }
    list.push(...deepCopy(input.events));
    return;
  }

  /** Cost from turn metrics; duration is completed_at − created_at, floored at 0. */
  private addTerminalSessionMetrics(sessionId: string, created_at: Date, state: TerminalTurnState): void {
    const stored = this.sessions.get(sessionKey(sessionId));
    if (!stored) {
      throw new SessionNotFoundError(sessionId);
    }
    const elapsed_ms = Date.parse(state.completed_at) - created_at.getTime();
    stored.record.metrics.total_cost_in_usd += state.metrics?.total_cost_in_usd ?? 0;
    stored.record.metrics.total_duration_ms += elapsed_ms > 0 ? Math.trunc(elapsed_ms) : 0;
  }

  private requireTurn(sessionId: string, turnId: string): TurnRecord<TTurnCustom> {
    const turn = this.turns.get(turnKey({ session_id: sessionId, turn_id: turnId }));
    if (!turn) {
      throw new TurnNotFoundError(turnId);
    }
    return turn;
  }

  private requireRunningTurn(sessionId: string, turnId: string): TurnRecord<TTurnCustom> {
    const turn = this.requireTurn(sessionId, turnId);
    if (turn.state.status !== 'running') {
      throw new TurnNotRunningError(turnId, turn.state);
    }
    return turn;
  }

  async addThreads(input: AddThreadsInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    for (const thread of input.threads) {
      turn.snapshot.threads[thread.thread_id] = deepCopy(thread);
    }
    turn.updated_at = new Date();
    return;
  }

  async removeThreads(input: RemoveThreadsInput): Promise<void> {
    if (input.thread_ids.length === 0) {
      return;
    }
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    for (const id of input.thread_ids) {
      Reflect.deleteProperty(turn.snapshot.threads, id);
    }
    turn.updated_at = new Date();
    return;
  }

  async appendToThreadContext(input: AppendToThreadContextInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    const thread = turn.snapshot.threads[input.thread_id];
    if (!thread) {
      throw new SessionStoreInvariantError(`Thread not found: ${input.thread_id}`);
    }
    thread.context.push(...deepCopy(input.context));
    if (input.current_context_usage !== null) {
      thread.current_context_usage = deepCopy(input.current_context_usage);
    }
    if (input.completion !== null) {
      thread.completion = deepCopy(input.completion);
    }
    turn.updated_at = new Date();
    return;
  }

  async overwriteThreadContext(input: OverwriteThreadContextInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    const threadId = input.event.thread_id;
    const thread = turn.snapshot.threads[threadId];
    if (!thread) {
      throw new SessionStoreInvariantError(`Thread not found: ${threadId}`);
    }
    thread.context = deepCopy(input.event.context);
    thread.current_context_usage = deepCopy(input.event.current_context_usage);
    turn.updated_at = new Date();
    return;
  }

  async patchMCPServers(input: PatchMCPServersInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    turn.snapshot.mcp_servers ??= {};
    for (const server of input.mcp_servers) {
      turn.snapshot.mcp_servers[server.id] = deepCopy(server);
    }
    turn.updated_at = new Date();
    return;
  }

  async patchSandboxInfo(input: PatchSandboxInfoInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    turn.snapshot.sandbox_info = deepCopy(input.sandbox_info);
    turn.updated_at = new Date();
    return;
  }

  async patchThreadCapabilityState(input: PatchThreadCapabilityStateInput): Promise<void> {
    const turn = this.requireRunningTurn(input.session_id, input.turn_id);
    const thread = turn.snapshot.threads[input.thread_id];
    if (!thread) {
      throw new SessionStoreInvariantError(`Thread not found: ${input.thread_id}`);
    }
    thread.capability_state ??= {};
    if (input.state === null) {
      Reflect.deleteProperty(thread.capability_state, input.key);
      if (Object.keys(thread.capability_state).length === 0) {
        thread.capability_state = null;
      }
    } else {
      thread.capability_state[input.key] = deepCopy(input.state);
    }
    turn.updated_at = new Date();
    return;
  }

  async listTurnEvents(input: ListTurnEventsInput): Promise<{
    data: PersistedTurnEvent[];
    pagination: TokenPagination;
  }> {
    this.requireTurn(input.session_id, input.turn_id);
    const list = this.events.get(turnKey(input));
    if (!list) {
      throw new TurnNotFoundError(input.turn_id);
    }
    const ordered = [...list].sort((a, b) =>
      input.order === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id),
    );
    const page = paginate(ordered, input.limit, input.page_token);
    return { data: deepCopy(page.data), pagination: page.pagination };
  }

  async listSessionEvents(input: ListSessionEventsInput): Promise<{
    data: SessionEventItem[];
    pagination: TokenPagination;
  }> {
    const stored = this.sessions.get(sessionKey(input.session_id));
    if (!stored) {
      throw new SessionNotFoundError(input.session_id);
    }

    const decodedCursor = input.page_token === undefined ? undefined : decodeSessionEventPageToken(input.page_token);
    const lastTurnId = decodedCursor?.last_turn_id ?? input.last_turn_id ?? stored.record.last_turn_id;
    if (lastTurnId === null) {
      return { data: [], pagination: { limit: input.limit } };
    }
    const cursor: SessionEventPageCursor = {
      last_turn_id: lastTurnId,
      offset: decodedCursor?.offset ?? 0,
    };

    const anchor = this.turns.get(turnKey({ session_id: input.session_id, turn_id: cursor.last_turn_id }));
    if (!anchor) {
      throw new TurnNotFoundError(cursor.last_turn_id);
    }
    const turnIds = this.resolveAncestorChain(input.session_id, anchor);
    const flattened: SessionEventItem[] = [];
    for (const turnId of [...turnIds].reverse()) {
      const evts = this.events.get(turnKey({ session_id: input.session_id, turn_id: turnId })) ?? [];
      for (const event of [...evts].sort((a, b) => b.id.localeCompare(a.id))) {
        flattened.push({ turn_id: turnId, event });
      }
    }
    const page = paginateSessionEventRows(
      flattened.slice(cursor.offset, cursor.offset + input.limit + 1),
      input.limit,
      cursor,
    );
    return { data: deepCopy(page.data), pagination: page.pagination };
  }

  /**
   * Full chain (oldest first, anchor last). `ancestor_ids` may be only the
   * previous N ancestors, so spill through the oldest ancestor's own window
   * until a root or gap. A missing turn or repeated id ends the walk.
   */
  private resolveAncestorChain(sessionId: string, anchor: TurnRecord<TTurnCustom>): string[] {
    const chain = [...anchor.ancestor_ids, anchor.turn_id];
    const seen = new Set(chain);
    let oldestId = chain[0];
    while (oldestId && oldestId !== anchor.turn_id) {
      const oldest = this.turns.get(turnKey({ session_id: sessionId, turn_id: oldestId }));
      if (!oldest) {
        break;
      }
      const older = oldest.ancestor_ids.filter(id => !seen.has(id));
      if (older.length === 0) {
        break;
      }
      chain.unshift(...older);
      for (const id of older) {
        seen.add(id);
      }
      oldestId = older[0];
    }
    return chain;
  }
}
