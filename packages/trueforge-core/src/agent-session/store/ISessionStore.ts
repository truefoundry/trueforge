import type { JsonValue } from '../../core/capabilities/AgentCapability';
import type { MCPServerInitInfo, ThreadOverwriteContextEvent } from '../../core/events/schema';
import type {
  AgentThreadSnapshot,
  ContextMessage,
  SubAgentCompletionMarker,
} from '../../core/runtime/AgentThread.types';
import type { CurrentContextUsage } from '../../core/runtime/contextUsage';
import type { SandboxInfo } from '../../core/sandbox/Sandbox';
import type { SessionRecord } from '../models/SessionRecord';
import type { TurnRecord } from '../models/TurnRecord';
import type { PersistedTurnEvent, SessionEventItem } from '../schemas/events';
import type { TokenPagination } from '../schemas/pagination';
import type { CancellationReason, TerminalTurnState } from '../schemas/turn';

/**
 * Caller-supplied fields for creating a session; the store owns timestamps and tip state.
 * `agent` is a discriminated reference | inline binding.
 */
export type CreateSessionInput<TSessionCustom extends object = Record<string, never>> = Pick<
  SessionRecord<TSessionCustom>,
  'tenant_id' | 'session_id' | 'agent' | 'created_by_subject' | 'external_id' | 'metadata'
> & {
  custom: TSessionCustom | null;
};

/**
 * PATCH fields for an existing session; `undefined` fields are left unchanged.
 * `agent` may be set only on inline sessions, and only as an inline arm (`{ type: 'inline', spec }`).
 * `metadata` when set fully replaces the stored map (`{}` clears).
 */
export type UpdateSessionInput<TSessionCustom extends object = Record<string, never>> = Pick<
  SessionRecord<TSessionCustom>,
  'tenant_id' | 'session_id'
> & {
  agent: Extract<SessionRecord<TSessionCustom>['agent'], { type: 'inline' }> | undefined;
  title: SessionRecord<TSessionCustom>['title'] | undefined;
  metadata: SessionRecord<TSessionCustom>['metadata'] | undefined;
};

export interface GetSessionInput {
  tenant_id: string;
  session_id: string;
}

export interface GetSessionByExternalIdInput {
  tenant_id: string;
  external_id: string;
}

export interface DeleteSessionInput {
  tenant_id: string;
  session_id: string;
}

export interface ListSessionsInput {
  tenant_id: string;
  limit: number;
  page_token: string | undefined;
  order: 'asc' | 'desc' | undefined;
  /** Inclusive lower bound on `created_at` (instant). */
  start_timestamp: Date | undefined;
  /** Inclusive upper bound on `created_at` (instant). */
  end_timestamp: Date | undefined;
  /** When set, only sessions bound to this named agent id. */
  agent_id: string | undefined;
  /** When set, only sessions whose `created_by_subject.subject_id` matches. */
  created_by_subject_id: string | undefined;
}

/** Turn row fields without assembled snapshot (create input / listTurns). */
export type TurnRecordWithoutSnapshot<TTurnCustom extends object = Record<string, never>> = Omit<
  TurnRecord<TTurnCustom>,
  'snapshot'
>;

/** Thread registration; mutable per-turn data arrives through dedicated createTurn fields. */
export type NewThreadInit = Omit<
  AgentThreadSnapshot,
  'context' | 'current_context_usage' | 'completion' | 'capability_state'
>;

/** Full post-send capability map for one thread. */
export type ThreadCapabilityStateInit = Pick<AgentThreadSnapshot, 'thread_id' | 'capability_state'>;

/** One drained send() append batch for one thread; writer = the new turn. */
export interface TurnContextAppend {
  thread_id: string;
  context: ContextMessage[];
  current_context_usage: CurrentContextUsage | null;
}

export interface CreateTurnInput<TTurnCustom extends object = Record<string, never>> {
  turn: TurnRecordWithoutSnapshot<TTurnCustom>;
  /** Threads absent on the previous turn (turn 1: the root thread; else empty). */
  new_threads: NewThreadInit[];
  /**
   * All new messages, for new and carried-forward threads alike — collected by
   * draining orchestrator.send() BEFORE this call. Draining without persisting is
   * safe: send() mutates only in-memory threads, and if createTurn fails the whole
   * in-memory state (orchestrator, threads, resolver) is discarded — so either this
   * turn commits atomically with its appends, or nothing was persisted at all.
   */
  new_context_appends: TurnContextAppend[];
  /**
   * Complete post-send capability maps: exactly one entry per turn thread.
   * Authoritative for this turn; the store does not carry capability rows forward.
   */
  capability_states: ThreadCapabilityStateInit[];
  /** Set only if session.title is NULL (first write wins). */
  update_session_title_if_not_exist: string | null;
}

export interface FreezeAndGetTurnInput {
  session_id: string;
  turn_id: string;
  /** Written onto the turn row when the freeze actually cancels a running turn. */
  reason: CancellationReason;
  /** Caller-built cancelled turn.done event; store persists atomically with state flip when it cancels. */
  turn_done_event: PersistedTurnEvent;
}

export interface GetTurnInput {
  session_id: string;
  turn_id: string;
}

export interface ListTurnsInput {
  session_id: string;
  limit: number;
  page_token: string | undefined;
}

export interface UpdateTurnStateInput {
  session_id: string;
  turn_id: string;
  state: TerminalTurnState;
  /** Caller-built turn.done; written atomically with the state flip in the same tx. */
  turn_done_event: PersistedTurnEvent;
}

export interface AppendToEventsInput {
  session_id: string;
  turn_id: string;
  events: PersistedTurnEvent[];
}

export interface AddThreadsInput {
  session_id: string;
  turn_id: string;
  threads: AgentThreadSnapshot[];
}

export interface RemoveThreadsInput {
  session_id: string;
  turn_id: string;
  thread_ids: string[];
}

export interface AppendToThreadContextInput {
  session_id: string;
  turn_id: string;
  thread_id: string;
  context: ContextMessage[];
  current_context_usage: CurrentContextUsage | null;
  completion: SubAgentCompletionMarker | null;
}

export interface OverwriteThreadContextInput {
  session_id: string;
  turn_id: string;
  event: ThreadOverwriteContextEvent;
}

export interface PatchMCPServersInput {
  session_id: string;
  turn_id: string;
  mcp_servers: MCPServerInitInfo[];
}

export interface PatchSandboxInfoInput {
  session_id: string;
  turn_id: string;
  sandbox_info: SandboxInfo;
}

export interface PatchThreadCapabilityStateInput {
  session_id: string;
  turn_id: string;
  thread_id: string;
  key: string;
  state: JsonValue;
}

export interface ListTurnEventsInput {
  session_id: string;
  turn_id: string;
  limit: number;
  page_token: string | undefined;
  order: 'asc' | 'desc' | undefined;
}

export interface ListSessionEventsInput {
  session_id: string;
  limit: number;
  page_token: string | undefined;
  last_turn_id: string | undefined;
}

/**
 * Session/turn persistence contract. Pure durability: no streaming, SSE, or
 * subscription members. Callers authorize the parent session before using
 * turn-scoped operations, which rely on globally unique session_id values.
 * Capability maps are initialized atomically by createTurn and subsequently
 * updated through patchThreadCapabilityState. Agent binding is session-scoped
 * as a discriminated `agent` (ref | value); named agents are not hydrated on read.
 */
export interface ISessionStore<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> {
  /**
   * Persists a discriminated `agent` (ref | value). SQL backends may flatten to columns.
   * `session_id` is globally unique across tenants.
   * Persists caller-supplied `created_by_subject` (immutable after create).
   * Sets `last_activity_timestamp_ms` (= now) on create.
   */
  createSession(input: CreateSessionInput<TSessionCustom>): Promise<void>;

  /** Permanently removes a session and all related data; missing sessions are a no-op. */
  deleteSession(input: DeleteSessionInput): Promise<void>;

  /**
   * Returns the session as stored (ref agents are not hydrated to a value).
   * Does **not** bump `last_activity_timestamp_ms` (read path).
   */
  getSession(input: GetSessionInput): Promise<SessionRecord<TSessionCustom> | undefined>;

  /**
   * Lookup by tenant-scoped `external_id`. Missing or null external ids are not found.
   * Does **not** bump `last_activity_timestamp_ms` (read path).
   */
  getSessionByExternalId(input: GetSessionByExternalIdInput): Promise<SessionRecord<TSessionCustom> | undefined>;

  /**
   * PATCH semantics — update only the provided fields:
   * - agent: replace inline binding (inline sessions only; reference → invariant error).
   * - title: set/replace the session title.
   * - metadata: full replace of the caller-owned string map when set.
   * Bumps `last_activity_timestamp_ms` (= now) in the same update.
   */
  updateSession(input: UpdateSessionInput<TSessionCustom>): Promise<void>;

  /**
   * Paginated list of the tenant's sessions ordered by `updated_at`
   * (`order` defaults to `desc`, `session_id` tie-break). `page_token` is a
   * keyset cursor on `(updated_at, session_id)`. `start_timestamp` /
   * `end_timestamp` are inclusive instant bounds on `created_at`. Optional
   * `agent_id` filters ref-bound sessions; optional `created_by_subject_id`
   * filters by `created_by_subject.subject_id`. Does **not** bump
   * `last_activity_timestamp_ms` (read path).
   */
  listSessions(
    input: ListSessionsInput,
  ): Promise<{ data: SessionRecord<TSessionCustom>[]; pagination: TokenPagination }>;

  /**
   * Creates the turn AND advances `session.last_turn_id`. Context merging is the
   * store's responsibility: `new_context_appends` and `new_threads` are applied
   * on top of the previous turn's snapshot when `turn.previous_turn_id` is set.
   * `capability_states` is the complete authoritative map for every resulting
   * thread and is persisted directly without store-side carry-forward.
   *
   * Atomicity (store contract): insert turn + set `last_turn_id` (+ session
   * turn-list append if the backend has one) MUST be one atomic unit per
   * session. Concurrent createTurn on the same session must not drop a turn
   * row or leave `last_turn_id` pointing at a turn that was never created.
   * The implementation supplies the mechanism (session lock, row lock/tx, …).
   *
   * Also bumps `session.last_activity_timestamp_ms` and increments
   * `session.metrics.total_turns` in that same atomic unit.
   *
   * Fork semantics for `turn.previous_turn_id`:
   * - `null` — new root turn (no parent); always allowed.
   * - string — fork/chain from that turn when it exists. Tip-equality is NOT
   *   required; concurrent forks from the same tip both succeed. Unknown id is
   *   allowed (relaxed) and treated as no inheritance. If that turn exists and
   *   is still `running`, reject with {@link PreviousTurnRunningError} —
   *   callers must {@link freezeAndGetTurn} first.
   * `last_turn_id` always advances to the new turn in the same atomic unit.
   *
   * `update_session_title_if_not_exist`: when set AND `session.title` is
   * unset/null, set it in the same atomic unit; an existing title is NEVER
   * overwritten (first write wins). The caller derives the value; the store
   * only conditionally sets it.
   */
  createTurn(input: CreateTurnInput<TTurnCustom>): Promise<void>;

  /**
   * Cancel if still running (persist `turn_done` and fold cost/duration into
   * `session.metrics`); already-terminal turns are a read. Missing → {@link TurnNotFoundError}.
   */
  freezeAndGetTurn(input: FreezeAndGetTurnInput): Promise<TurnRecord<TTurnCustom>>;

  /** Returns the turn record, or undefined if not found in this session. */
  getTurn(input: GetTurnInput): Promise<TurnRecord<TTurnCustom> | undefined>;

  /** Paginated list of turn rows (no snapshot); use getTurn for assembled snapshot. */
  listTurns(
    input: ListTurnsInput,
  ): Promise<{ data: TurnRecordWithoutSnapshot<TTurnCustom>[]; pagination: TokenPagination }>;

  /**
   * First terminal write wins (`running` → done/cancelled/error); otherwise 409.
   * Winning write also folds cost/duration into `session.metrics`. Missing → 404.
   * Must use the same lock/CAS as other turn mutations.
   */
  updateTurnState(input: UpdateTurnStateInput): Promise<void>;

  /**
   * Durable event log for the turn. MUST include lifecycle rows: a
   * `TurnCreatedEvent` at the start of the stream and a terminal `TurnDoneEvent`
   * (or its cancelled/error shape) at the end. Every turn written through this
   * API persists lifecycle in the stream — implementations never synthesize
   * missing created/done rows on read. Every event MUST carry `id` and
   * `created_at`; `id` is a monotonic ULID and is the primary within-turn sort
   * key. `created_at` records event creation time but is not the order key.
   */
  appendToEvents(input: AppendToEventsInput): Promise<void>;

  /** Adds thread snapshots to the turn (sub-agent spawns). */
  addThreads(input: AddThreadsInput): Promise<void>;

  /** Removes threads from the turn by id. */
  removeThreads(input: RemoveThreadsInput): Promise<void>;

  /** Appends messages to a thread's context; optionally updates usage / completion marker. */
  appendToThreadContext(input: AppendToThreadContextInput): Promise<void>;

  /** Replaces a thread's context wholesale (context-overwrite event). */
  overwriteThreadContext(input: OverwriteThreadContextInput): Promise<void>;

  /** Patches the turn snapshot's MCP server init info (by source id). */
  patchMCPServers(input: PatchMCPServersInput): Promise<void>;

  /** Patches the turn snapshot's sandbox info (id for cross-turn reattach). */
  patchSandboxInfo(input: PatchSandboxInfoInput): Promise<void>;

  /** Generic capability KV — store has zero Plan/feature knowledge. */
  patchThreadCapabilityState(input: PatchThreadCapabilityStateInput): Promise<void>;

  /** Paginated read ordered lexically by monotonic `event.id` (asc default). */
  listTurnEvents(input: ListTurnEventsInput): Promise<{
    data: PersistedTurnEvent[];
    pagination: TokenPagination;
  }>;

  /**
   * Paginated session-wide feed of persisted events across turns, including
   * turn.created / turn.done lifecycle rows. Reads only — never synthesizes.
   *
   * Includes events from **running** turns (the HTTP layer may 409 separately;
   * that is not store semantics). Ordering: newest turn first, then monotonic
   * `event.id` descending within each turn. `last_turn_id` anchors the window
   * to that turn plus its ancestors; when omitted, the session's current
   * `last_turn_id` selects the active branch. Continuation page tokens encode
   * that anchor and take precedence over `last_turn_id`, so later session
   * activity cannot move an in-progress pagination walk to another branch.
   * `ancestor_ids` may include only the previous N ancestors and need not reach
   * the root — implementations must spill through older turns' own
   * `ancestor_ids` when needed. Sibling branches from forks are excluded.
   */
  listSessionEvents(input: ListSessionEventsInput): Promise<{
    data: SessionEventItem[];
    pagination: TokenPagination;
  }>;
}
