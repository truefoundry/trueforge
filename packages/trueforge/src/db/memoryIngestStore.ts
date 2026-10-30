/** Memory ingestion progress per session, plus the read paths the ingest loop needs. */
import type {
  CreatedBySubject,
  PersistedTurnEvent,
  TurnInputItem,
  TurnState,
} from '@truefoundry/trueforge-core/agent-session';

export type StoredModelMessage = Extract<PersistedTurnEvent, { type: 'model.message' }>;

/** JSON path of `AgentSpec.config.memory.enabled` in a registry agent's stored manifest. */
export const AGENT_MEMORY_ENABLED_PATH = ['config', 'memory', 'enabled'] as const;

export interface MemoryIngestCursor {
  session_id: string;
  /** Last turn whose exchange the provider accepted; null before the first send. */
  last_ingested_turn_id: string | null;
  /** Provider-side thread for the session. A session's memory scope never changes, so neither does its owner. */
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

/**
 * Which sessions a run looks at, by `session.updated_at`. That moves when a turn is created, so it
 * bounds the latest turn's start; turns finish within the execution timeout.
 */
export interface ListMemoryIngestCandidatesInput {
  /** Any session updated at or after this instant. */
  recent_since: Date;
  /**
   * Plus sessions whose tip turn is paused on the user (a question, approval or auth), updated in
   * [`paused_from`, `paused_until`): their pause has timed out, so what exists is sent.
   */
  paused_from: Date;
  paused_until: Date;
  /** Only candidates strictly after this key, so runs can continue where the last one stopped. */
  after: MemoryIngestCandidateKey | undefined;
  limit: number;
}

export type UpsertMemoryIngestCursorInput = Omit<MemoryIngestCursor, 'updated_at'>;

export interface IMemoryIngestStore {
  /**
   * Non-scheduled sessions that are UI chats without an agent or bound to an agent with memory
   * enabled, in the recent or paused range, whose tip turn is not yet ingested. Ordered by
   * (session.updated_at, session_id), oldest first. Not index-backed yet: the scan crosses tenants,
   * so add a `session (updated_at, session_id)` index if traffic grows.
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
