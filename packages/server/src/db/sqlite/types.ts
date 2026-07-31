/**
 * Live app schema for the SQLite-backed session store.
 * Migrations must not use this type — use `Kysely<unknown>` instead.
 *
 * JSON payload columns are BLOB JSONB on disk. Reads must project `json(column)`;
 * `ParseJSONResultsPlugin` (configured in createSqliteDb) parses those top-level columns only.
 */
import type { AgentSpec, PersistedTurnEvent, TurnInputItem, TurnState } from '@truefoundry/utils/agent-session';
import type {
  AgentInfo,
  AgentParent,
  ContextMessage,
  JsonValue,
  MCPServerInitInfo,
  SandboxInfo,
  SubAgentCompletionMarker,
} from '@truefoundry/utils/core';
import type { CurrentContextUsage } from '@truefoundry/utils/core/runtime/contextUsage';
import type { ColumnType, Generated, JSONColumnType } from 'kysely';

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

/** Insert via `jsonbBind()`; select via `jsonText()` (parsed at top-level only). */
type JsonbColumn<T extends object | null> = JSONColumnType<T, T | string, T | string>;

/**
 * PRIMARY KEY (tenant_id, session_id)
 * CREATE INDEX session_list_idx ON session (tenant_id, created_at, session_id)
 */
export interface SessionTable {
  tenant_id: string;
  session_id: string;
  agent_spec: JsonbColumn<AgentSpec>;
  title: string | null;
  last_turn_id: string | null;
  custom: JsonbColumn<Record<string, unknown>> | null;
  created_at: string;
  updated_at: string;
  last_activity_timestamp_ms: number;
}

/**
 * PRIMARY KEY (tenant_id, session_id, turn_id)
 * CREATE INDEX turn_list_idx ON turn (tenant_id, session_id, created_at, turn_id)
 */
export interface TurnTable {
  tenant_id: string;
  session_id: string;
  turn_id: string;
  first_turn_id: string;
  previous_turn_id: string | null;
  /** JSONB array of turn ids — topology only; not a SQL join key. */
  ancestor_ids: JsonbColumn<string[]>;
  input: JsonbColumn<TurnInputItem[]>;
  state: JsonbColumn<TurnState>;
  checkpoint: JsonbColumn<TurnCheckpoint>;
  custom: JsonbColumn<Record<string, unknown>> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Complete state of one thread at one turn.
 * Context order lives in `turn_thread_context` (no context_ids column).
 * PRIMARY KEY (tenant_id, session_id, turn_id, thread_id)
 */
export interface TurnThreadTable {
  tenant_id: string;
  session_id: string;
  turn_id: string;
  thread_id: string;
  checkpoint: JsonbColumn<TurnThreadCheckpoint>;
  agent_info: JsonbColumn<AgentInfo> | null;
  current_context_usage: JsonbColumn<CurrentContextUsage>;
  updated_at: string;
}

/**
 * Ordered mapping from a turn_thread to append-only log rows.
 * PRIMARY KEY (tenant_id, session_id, turn_id, thread_id, pos)
 */
export interface TurnThreadContextTable {
  tenant_id: string;
  session_id: string;
  turn_id: string;
  thread_id: string;
  pos: number;
  append_id: number;
}

/**
 * Pure immutable client-facing event log.
 * PRIMARY KEY (tenant_id, session_id, turn_id, event_id)
 */
export interface SessionEventTable {
  tenant_id: string;
  session_id: string;
  turn_id: string;
  event_id: string;
  event: JsonbColumn<PersistedTurnEvent>;
  created_at: string;
}

/**
 * Pure immutable content; no state → no checkpoint field.
 * PRIMARY KEY (append_id) AUTOINCREMENT
 */
export interface ThreadContextLogTable {
  append_id: Generated<number>;
  tenant_id: string;
  session_id: string;
  thread_id: string;
  turn_id: string;
  body: JsonbColumn<ContextMessage>;
  created_at: string;
}

/**
 * Per-turn KV snapshot, latest-wins per (turn, thread, key).
 * PRIMARY KEY (tenant_id, session_id, turn_id, thread_id, key)
 */
export interface ThreadCapabilityStateTable {
  tenant_id: string;
  session_id: string;
  turn_id: string;
  thread_id: string;
  key: string;
  /** JSONB JsonValue, or SQL NULL if cleared. */
  state: ColumnType<JsonValue | null, JsonValue | null | string, JsonValue | null | string>;
  updated_at: string;
}

export interface Database {
  session: SessionTable;
  turn: TurnTable;
  turn_thread: TurnThreadTable;
  turn_thread_context: TurnThreadContextTable;
  session_event: SessionEventTable;
  thread_context_log: ThreadContextLogTable;
  thread_capability_state: ThreadCapabilityStateTable;
}
