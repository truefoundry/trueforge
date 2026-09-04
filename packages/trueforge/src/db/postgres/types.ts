/**
 * Live app schema for the runtime Kysely client / Postgres-backed session store.
 * Migrations must not use this type — use `Kysely<unknown>` instead.
 */
import type {
  AgentSpec,
  CreatedBySubject,
  PersistedTurnEvent,
  SessionMetadata,
  SessionMetrics,
  TurnInputItem,
  TurnState,
} from '@truefoundry/trueforge-core/agent-session';
import type {
  AgentInfo,
  AgentParent,
  ContextMessage,
  JsonValue,
  MCPServerInitInfo,
  SandboxInfo,
  SubAgentCompletionMarker,
} from '@truefoundry/trueforge-core/core';
import type { CurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import type { ColumnType, Generated, JSONColumnType } from 'kysely';
import type { McpServerManifest } from '../../schemas/mcpServer';
import type { ModelProviderManifest } from '../../schemas/modelProvider';
import type { SandboxBuildMetadata, SandboxBuildStatus, SandboxProviderManifest } from '../../schemas/sandboxProvider';
import type { ScheduleManifest, ScheduleRunStatus, ScheduleStatus } from '../../schemas/schedule';
import type { SkillManifest } from '../../schemas/skill';
import type { OAuthClient, OAuthPendingAuthorizationData, OAuthServer, OAuthToken } from '../mcpServerStore';

/**
 * Trace-level state for one thread at one turn (`turn_thread.checkpoint`).
 * Total types: `completion` is explicitly null until set — no optional keys.
 */
export interface TurnThreadCheckpoint {
  parent: AgentParent | null;
  completion: SubAgentCompletionMarker | null;
}

/** Turn-level checkpoint — threads live in `turn_thread`; only owned top-level keys remain. */
export interface TurnCheckpoint {
  mcp_servers: Record<string, MCPServerInitInfo> | null;
  sandbox_info: SandboxInfo | null;
}

/**
 * PRIMARY KEY (session_id)
 * WITH (fillfactor = 85); headroom so the per-turn bump stays HOT (no index churn)
 * CREATE INDEX session_list_idx ON session (tenant_id, created_at, session_id)
 */
export interface SessionTable {
  /** key */
  tenant_id: string;
  /** key */
  session_id: string;
  /** Caller identity that created the session (immutable after create). */
  created_by_subject: JSONColumnType<CreatedBySubject, CreatedBySubject, CreatedBySubject>;
  /**
   * Named registry binding; XOR with `agent_spec`
   * (CHECK session_agent_xor_check).
   */
  agent_id: string | null;
  /**
   * Create-time snapshot of registry agent name for ref bindings.
   * Null for value sessions and orphan/legacy refs after a missed backfill.
   */
  agent_name: string | null;
  /**
   * Inline spec binding; XOR with `agent_id`.
   * TOAST pointer rides through per-turn tip bumps when present.
   */
  agent_spec: JSONColumnType<AgentSpec, AgentSpec | null, AgentSpec | null> | null;
  /**
   * top: list-displayed, independently patched; first-write-wins
   *      (COALESCE) targets it directly
   */
  title: string | null;
  /**
   * top: HOT — bumped once per createTurn under the session lock;
   *      tiny fixed-width column keeps the bump a cheap HOT update
   */
  last_turn_id: string | null;
  /**
   * Optional unique key within `tenant_id` (`session_external_id_uq`,
   * partial WHERE external_id IS NOT NULL).
   */
  external_id: string | null;
  /** top: caller-owned opaque extension; never mixed with store state */
  custom: JSONColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> | null;
  /** Caller-owned metadata; always present (DEFAULT '{}'). */
  metadata: JSONColumnType<SessionMetadata, SessionMetadata, SessionMetadata>;
  metrics: JSONColumnType<SessionMetrics, SessionMetrics, SessionMetrics>;
  /** top: list ordering (indexed below) */
  created_at: Date;
  updated_at: Date;
  /**
   * top: hot, bumped with the tip ("activity" = turn creation)
   */
  last_activity_timestamp_ms: number;
}

/**
 * PRIMARY KEY (session_id, turn_id)
 * WITH (fillfactor = 85); headroom for the state flip + rare checkpoint patches
 * CREATE INDEX turn_list_idx ON turn (session_id, created_at, turn_id)
 */
export interface TurnTable {
  /** key */
  session_id: string;
  /** key (ulid) */
  turn_id: string;
  /** top: immutable topology; filter target */
  first_turn_id: string;
  /** top: immutable topology; NULL = session's first turn */
  previous_turn_id: string | null;
  /**
   * top: immutable; queried by the anchored ancestor-chain walk
   *      (spill through older turns); typed array
   */
  ancestor_ids: string[];
  /** top: big + written once at create; TOAST pointer stable after */
  // Insert arrays/objects via json() helper (bare JS arrays become PG arrays via node-pg).
  input: JSONColumnType<TurnInputItem[], TurnInputItem[] | string, TurnInputItem[] | string>;
  /**
   * top: THE fence/freeze target — every gated write predicates on
   *      state->>'status'; exactly one terminal flip per turn
   */
  state: JSONColumnType<TurnState, TurnState, TurnState>;
  /**
   * inlined: {mcp_servers, sandbox_info, ...future} — both small,
   *      patched at most once or twice per turn (resource init);
   *      extensible without migration
   */
  checkpoint: JSONColumnType<TurnCheckpoint, TurnCheckpoint, TurnCheckpoint>;
  /** top: caller-owned opaque extension */
  custom: JSONColumnType<
    Record<string, unknown>,
    Record<string, unknown> | string,
    Record<string, unknown> | string
  > | null;
  /** top: list ordering (indexed below) */
  created_at: Date;
  updated_at: Date;
}

/**
 * the complete STATE of one thread at one turn
 * PRIMARY KEY (session_id, turn_id, thread_id)
 * WITH (fillfactor = 70); the ONE deliberately-hot table: rewritten 5–10x while its
 * turn runs; immutable once the turn is terminal (fence)
 */
export interface TurnThreadTable {
  /** key */
  session_id: string;
  /** key */
  turn_id: string;
  /** key */
  thread_id: string;
  /**
   * inlined: {parent, completion, ...future} — parent: small,
   *      immutable; completion: can be big but written ONCE at
   *      thread end (rare + terminal); the hot path below never
   *      touches this jsonb
   */
  checkpoint: JSONColumnType<TurnThreadCheckpoint, TurnThreadCheckpoint, TurnThreadCheckpoint>;
  /**
   * top: big + immutable thread IDENTITY. Real data: sub-agent
   *      instructions in one working session ran 2.4–8.8KB
   *      (median 4.4KB) — always past the ~2KB TOAST threshold,
   *      so a dedicated column lets every array rewrite carry the
   *      TOAST value by pointer instead of re-serializing it.
   *      Deliberately duplicates context[0] (the task is also the
   *      thread's first user message): the log copy is
   *      conversation state and compaction may reclaim it; this
   *      copy is identity and must survive context surgery
   *      (restore re-resolves the child definition from
   *      name/model/input here). NULL for the root thread.
   */
  agent_info: JSONColumnType<AgentInfo, AgentInfo | null, AgentInfo | null> | null;
  /**
   * top: hot — set by the SAME single-statement UPDATE as the
   *      array concat (zero extra row versions; ~300B inline;
   *      byte-neutral vs stamping log rows). Kept out of
   *      checkpoint so the jsonb never rewrites on the hot path.
   *      Escape hatch: if the array ever becomes write-once
   *      (ranges / writer-filter), move this back onto
   *      thread_context_log rows (previously validated design).
   */
  current_context_usage: JSONColumnType<CurrentContextUsage, CurrentContextUsage, CurrentContextUsage>;
  /**
   * top: THE context — log append_ids in context order. Hot
   *      concat target (`||`), typed bigint[] operator; dominant
   *      TOAST value (~8KB at 1k live messages, entire value
   *      rewritten per append batch — the accepted cost of the
   *      raw-array choice; range-encoding is the recorded shrink
   *      if measured).
   */
  // Real Postgres bigint[] — bind JS number[] directly (NOT via json(); that is the jsonb trap).
  // Select path: int8[] OID 1016 parser in client.ts yields number[].
  context_ids: number[];
  updated_at: Date;
}

/**
 * pure immutable client-facing event log
 * PRIMARY KEY (session_id, turn_id, event_id)
 * pure INSERT → fillfactor 100
 */
export interface SessionEventTable {
  /** key */
  session_id: string;
  /** top: every read is turn-scoped or turn-attributed (envelope) */
  turn_id: string;
  /**
   * top/key: event.id, a process-local monotonic ULID minted when the event is
   *      created. Lexical ordering preserves the single turn writer's creation
   *      order, including events created in the same millisecond.
   *
   * A database auto-increment id is deliberately not used: it assigns order
   *      at persistence rather than event creation, couples the contract to
   *      Postgres, and sequence allocation across pooled connections,
   *      transactions, retries, or larger sequence caches need not represent
   *      logical event order. The event already owns a portable unique id, so
   *      a second store-generated identity would duplicate identity and make
   *      ordering backend-dependent.
   *
   * @see https://github.com/ulid/spec#monotonicity
   */
  event_id: string;
  /** top: PersistedTurnEvent payload, written once */
  event: JSONColumnType<PersistedTurnEvent, PersistedTurnEvent, PersistedTurnEvent>;
  /**
   * top: copied from event.created_at (required by PersistedTurnEvent), so
   *      future time-range filters can be indexed without inspecting jsonb.
   *      Ordering still uses event_id.
   */
  created_at: Date;
}

/**
 * pure immutable CONTENT; no state → no checkpoint field
 * PRIMARY KEY (session_id, thread_id, append_id)
 * pure INSERT → default fillfactor 100, zero dead tuples;
 * cleanup is whole-session delete only
 */
export interface ThreadContextLogTable {
  /** key */
  session_id: string;
  /** key */
  thread_id: string;
  /**
   * top: THE message id — store-assigned (the delta createTurn
   *      interface killed content addressing: the store is told
   *      what's new, so no hashing/dedupe); consumed by
   *      data-modifying CTE in the same statement (RETURNING
   *      → array concat, one network call). bigint on purpose:
   *      no exhaustion (~290M years at 1k msg/s; int4 would die
   *      in months). NOT an order key: the array is the sole
   *      order authority (reads use unnest WITH ORDINALITY).
   *      Cross-statement id order is NEVER relied on for context
   *      (pool + sequence CACHE could invert it); the only id
   *      ordering used is INTRA-statement (array_agg ORDER BY
   *      append_id over one INSERT's RETURNING = VALUES order,
   *      backend-local, safe under any CACHE setting)
   */
  append_id: Generated<number>;
  /**
   * top: provenance — which turn wrote the row; debugging + the
   *      future writer-filter migration; tiny; NOT used for
   *      visibility (the array is the sole visibility authority)
   */
  turn_id: string;
  /** top: the ContextMessage — written exactly once, never updated */
  body: JSONColumnType<ContextMessage, ContextMessage, ContextMessage>;
  /**
   * top: future indexed time filters without a table rewrite
   */
  created_at: Date;
}

/**
 * PER-TURN KV snapshot, latest-wins per (turn, thread, key)
 * PRIMARY KEY (session_id, turn_id, thread_id, key)
 * WITH (fillfactor = 85); single-statement fenced upsert per CAPABILITY_STATE event
 *
 * Capability history is per-turn on purpose: createTurn carries the previous
 * turn's rows forward (one INSERT..SELECT), so every turn owns its complete
 * map — fork fidelity and terminal immutability beat the tiny row duplication.
 * A cross-turn latest-wins PK was tried and REVERTED for the fork reason.
 */
export interface ThreadCapabilityStateTable {
  /** key */
  session_id: string;
  /**
   * key: capability history is PER TURN — fork/restore from any
   *      turn must see the map AS OF that turn, and a frozen
   *      turn's map must never change under it. (A cross-turn
   *      latest-wins PK was tried and REVERTED for exactly the
   *      fork reason.)
   */
  turn_id: string;
  /** key */
  thread_id: string;
  /** key: capability state key; `tfy.` prefix reserved */
  key: string;
  /**
   * top: the value IS the row — JsonValue (undefined banned at
   *      the harness boundary); NULL = explicitly cleared
   */
  // Insert via json() so scalars/arrays are not mis-encoded by node-pg.
  // ColumnType (not JSONColumnType): select may be any JSON value, including scalars / null.
  state: ColumnType<JsonValue | null, JsonValue | null, JsonValue | null>;
  updated_at: Date;
}

/**
 * Configured model providers — manifest pattern: identity as columns,
 * everything else in one Zod-validated jsonb document.
 * PRIMARY KEY (tenant_id, name)
 */
export interface ModelProviderTable {
  /** key */
  tenant_id: string;
  /** key: natural key within tenant; first segment of fully qualified model names */
  name: string;
  /** ModelProvider document; replaced whole on every upsert */
  manifest: JSONColumnType<ModelProviderManifest, ModelProviderManifest, ModelProviderManifest>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Configured skills — mirrors the Postgres `skill` table.
 * PRIMARY KEY (tenant_id, name)
 */
export interface SkillTable {
  /** key */
  tenant_id: string;
  /** key: natural key within tenant; also duplicated inside `manifest` */
  name: string;
  /** SkillManifest document; replaced whole on every upsert */
  manifest: JSONColumnType<SkillManifest, SkillManifest, SkillManifest>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Configured sandbox provider — mirrors the Postgres `sandbox_provider` table.
 * PRIMARY KEY (tenant_id) — at most one row per tenant.
 */
export interface SandboxProviderTable {
  /** key */
  tenant_id: string;
  /** SandboxProviderManifest document; replaced whole on every upsert */
  manifest: JSONColumnType<SandboxProviderManifest, SandboxProviderManifest, SandboxProviderManifest>;
  /** Last persisted build status of the release sandbox image. */
  status: SandboxBuildStatus;
  /** Human-readable detail for `status`; null when ready. */
  status_reason: string | null;
  /** SandboxBuildMetadata document (opaque string map); null when the provider has none. */
  build_metadata: JSONColumnType<SandboxBuildMetadata | null, SandboxBuildMetadata | null, SandboxBuildMetadata | null>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Configured agents — immutable ULID `id` PK; UNIQUE immutable (tenant_id, name).
 * PRIMARY KEY (id)
 */
export interface AgentTable {
  /** application-generated (ulid); never re-derived from tenant_id/name */
  id: string;
  tenant_id: string;
  /** immutable natural uniqueness target within a tenant */
  name: string;
  /** AgentSpec document; replaced whole on every upsert */
  manifest: JSONColumnType<AgentSpec, AgentSpec, AgentSpec>;
  external_id: string | null;
  created_by_subject: JSONColumnType<CreatedBySubject, CreatedBySubject, CreatedBySubject>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Configured schedules — immutable ULID `id` PK.
 * PRIMARY KEY (id)
 * CREATE INDEX schedule_agent_idx ON schedule (tenant_id, agent_name)
 * CREATE INDEX schedule_agent_id_idx ON schedule (tenant_id, agent_id)
 * FK (agent_id) → agent(id) ON DELETE CASCADE
 */
export interface ScheduleTable {
  /** application-generated (ulid); FK target for schedule_run */
  id: string;
  tenant_id: string;
  /** FK → agent(id). Immutable. */
  agent_id: string;
  /** Create-time snapshot of registry agent name. */
  agent_name: string;
  /** Display label; not unique. */
  name: string;
  /** ScheduleManifest document ({ task, cron, timezone }); replaced whole on update */
  manifest: JSONColumnType<ScheduleManifest, ScheduleManifest, ScheduleManifest>;
  /** `paused` stops triggering and drops the pending run; in-flight runs continue */
  status: ScheduleStatus;
  created_by_subject: JSONColumnType<CreatedBySubject, CreatedBySubject, CreatedBySubject>;
  created_at: Date;
  updated_at: Date;
}

/**
 * One row per run, pending or historical.
 * PRIMARY KEY (id)
 */
export interface ScheduleRunTable {
  /** application-generated (ulid) */
  id: string;
  tenant_id: string;
  /** FK -> schedule.id, ON DELETE CASCADE */
  schedule_id: string;
  /** unique per trigger time: `sched-<unixSeconds>` for cron, `manual-<token>` for run-now */
  name: string;
  scheduled_for: Date;
  /** `scheduled` | `triggered` | `failed` | `missed` — varchar(16) */
  status: ScheduleRunStatus;
  created_by_subject: JSONColumnType<CreatedBySubject, CreatedBySubject, CreatedBySubject>;
  triggered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * PRIMARY KEY (id)
 * UNIQUE (tenant_id, name) — the natural lookup key.
 */
export interface McpServerTable {
  id: string;
  tenant_id: string;
  /** the uniqueness target; also duplicated inside `manifest` */
  name: string;
  manifest: JSONColumnType<McpServerManifest, McpServerManifest, McpServerManifest>;
  /** OAuthServer — { authorization_endpoint, token_endpoint, code_challenge_methods_supported }.
   * RFC 8414 authorization-server metadata, discovered once at registration time.
   */
  oauth_server: JSONColumnType<OAuthServer, OAuthServer, OAuthServer> | null;
  /** OAuthClient — { client_id, client_secret }. RFC 7591 DCR response.
   * Token auth is form-body (client_secret_post) when client_secret is set; presence of secret
   * alone decides the method (same as servicefoundry outbound DCR). Both oauth_server and
   * oauth_client are null until first successful DCR.
   */
  oauth_client: JSONColumnType<OAuthClient, OAuthClient, OAuthClient> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * PRIMARY KEY (oauth_server_id, user_id)
 * No `tenant_id` — already scoped to tenant via the FK. Tokens are per harness user
 * (`user_id` = `RequestContext.subject.id`); any tenant-scoped read resolves `oauth_server_id`
 * through mcp_server (by tenant_id + name) first.
 */
export interface OAuthTokenTable {
  /** FK -> mcp_server.id, ON DELETE CASCADE */
  oauth_server_id: string;
  user_id: string;
  /** access_token, refresh_token, expires_at, scope. */
  token: JSONColumnType<OAuthToken, OAuthToken, OAuthToken>;
  updated_at: Date;
}

/**
 * PRIMARY KEY (id)
 *
 * `id` is this table's own identity column, used as the OAuth wire `state` query
 * parameter.
 */
export interface OAuthPendingAuthorizationTable {
  id: string;
  /** FK -> mcp_server.id, ON DELETE CASCADE */
  oauth_server_id: string;
  user_id: string;
  auth_data: JSONColumnType<
    OAuthPendingAuthorizationData,
    OAuthPendingAuthorizationData,
    OAuthPendingAuthorizationData
  >;
  /** filtered against `PENDING_AUTHORIZATION_TTL_MS` on read, no sweep job */
  created_at: Date;
}

/**
 * Write-heat summary: `turn_thread` is the one deliberately-hot table with its hot
 * columns (`context_ids`, `current_context_usage`) isolated from the pointer-carried
 * big ones (`agent_info`, `checkpoint`); `session`, `turn`, and
 * `thread_capability_state` take small bounded HOT-friendly updates; the two logs
 * are pure insert. Nothing ever rewrites a large value except the array concat
 * itself — the documented, bounded cost of the raw-array model. `model_provider`,
 * `skill`, `sandbox_provider`, `agent`, `mcp_server`, and the two `oauth_*` tables
 * are low-write, low-volume (one row per tenant/resource, or short-lived).
 * `schedule` is low-write; `schedule_run` takes a handful of bounded updates per
 * trigger and is otherwise append-only.
 *
 * Canonical Kysely database.
 */
export interface Database {
  session: SessionTable;
  turn: TurnTable;
  turn_thread: TurnThreadTable;
  session_event: SessionEventTable;
  thread_context_log: ThreadContextLogTable;
  thread_capability_state: ThreadCapabilityStateTable;
  model_provider: ModelProviderTable;
  skill: SkillTable;
  sandbox_provider: SandboxProviderTable;
  agent: AgentTable;
  schedule: ScheduleTable;
  schedule_run: ScheduleRunTable;
  mcp_server: McpServerTable;
  oauth_token: OAuthTokenTable;
  oauth_pending_authorization: OAuthPendingAuthorizationTable;
}
