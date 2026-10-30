/** Memory ingestion progress per session, plus the read paths the ingest loop needs. */
import type {
  CreatedBySubject,
  PersistedTurnEvent,
  TurnInputItem,
  TurnState,
} from '@truefoundry/trueforge-core/agent-session';

export type StoredModelMessage = Extract<PersistedTurnEvent, { type: 'model.message' }>;

/**
 * JSON path of the agent-level memory toggle in a registry agent's manifest.
 * TODO(agent-memory-toggle): add a MemoryConfig to RuntimeConfigSchema when agent builder exposes it.
 */
export const AGENT_MEMORY_ENABLED_PATH = ['runtime', 'memory', 'enabled'] as const;

export interface MemoryIngestCursor {
  session_id: string;
  /** Memory scope the session was last ingested under. */
  scope_key: string;
  /** Last turn whose exchange the provider accepted; null before the first send. */
  last_ingested_turn_id: string | null;
  /** Provider-side thread for the session in `scope_key`. */
  external_thread_id: string | null;
  last_error: string | null;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface MemoryIngestCandidate {
  session_id: string;
  tenant_id: string;
  created_by_subject: CreatedBySubject;
  agent_id: string | null;
  agent_name: string | null;
  /** `metadata['tfg.source']`, when present. */
  tfg_source: string | null;
  agent_memory_enabled: boolean;
  tip_turn_id: string;
  /** ISO-8601 UTC instant the tip turn last changed. */
  tip_updated_at: string;
  /** `session.updated_at` as ISO-8601 UTC, at the backend's full precision; the keyset position. */
  session_updated_at: string;
  cursor: MemoryIngestCursor | null;
}

export interface MemoryIngestTurn {
  turn_id: string;
  previous_turn_id: string | null;
  input: TurnInputItem[];
  state: TurnState;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface MemoryIngestModelMessage {
  turn_id: string;
  message: StoredModelMessage;
}

/** Keyset position in the candidate order. */
export type MemoryIngestCandidateKey = Pick<MemoryIngestCandidate, 'session_updated_at' | 'session_id'>;

export interface ListMemoryIngestCandidatesInput {
  /**
   * Only sessions updated at or after this instant. `session.updated_at` moves when a turn is
   * created, so this bounds the latest turn's start; turns finish within the execution timeout.
   */
  updated_since: Date;
  /** Only candidates strictly after this key, so runs can continue where the last one stopped. */
  after?: MemoryIngestCandidateKey;
  limit: number;
}

export interface UpsertMemoryIngestCursorInput {
  session_id: string;
  scope_key: string;
  last_ingested_turn_id: string | null;
  external_thread_id: string | null;
  last_error: string | null;
}

export interface IMemoryIngestStore {
  /**
   * Non-scheduled sessions that are UI chats or bound to an agent with memory enabled, updated
   * since `updated_since`, whose tip turn is not yet ingested. Ordered by
   * (session.updated_at, session_id), oldest first, which `session_memory_ingest_idx` serves.
   */
  listCandidateSessions(input: ListMemoryIngestCandidatesInput): Promise<MemoryIngestCandidate[]>;
  /** Every turn of the session (all branches), ordered by (created_at, turn_id). */
  listSessionTurns(input: { session_id: string }): Promise<MemoryIngestTurn[]>;
  /** Main-thread `model.message` events of the given turns, ordered by (turn_id, event_id). */
  listMainThreadModelMessages(input: {
    session_id: string;
    turn_ids: readonly string[];
  }): Promise<MemoryIngestModelMessage[]>;
  upsertCursor(input: UpsertMemoryIngestCursorInput): Promise<void>;
}
