import type { SessionAgent, SessionMetadata, SessionMetrics } from '../schemas/session';

/**
 * Session persistence record. Agent binding is a single discriminated `agent`
 * (`reference` | `inline`). Reference rows carry create-time `name` snapshot
 * (nullable for legacy/orphan). Named agents are not hydrated to inline on read.
 */
export interface SessionRecord<TCustom extends object = Record<string, never>> {
  tenant_id: string;
  session_id: string;
  /** Caller identity that created the session (immutable after create). */
  created_by: string;
  agent: SessionAgent;
  /**
   * Public session title (nullable). Written via updateSession patch or createTurn's
   * update_session_title_if_not_exist (first write wins; caller derives).
   */
  title: string | null;
  /**
   * Optional caller-supplied key, unique within a tenant when set.
   * Null means the session has no external id.
   */
  external_id: string | null;
  /**
   * Session tip — used for `previous_turn_id: 'auto'` resolution and turn
   * listing anchors. Advanced only by `createTurn` (atomic link).
   */
  last_turn_id: string | null;
  /** Instant the session was created (store domain). Wire/API serialize as ISO-8601. */
  created_at: Date;
  /** Instant the session was last updated (store domain). Wire/API serialize as ISO-8601. */
  updated_at: Date;
  /**
   * Liveness clock (ms since epoch). The store bumps it on createSession,
   * updateSession, and createTurn — never on reads.
   */
  last_activity_timestamp_ms: number;
  metrics: SessionMetrics;
  metadata: SessionMetadata;
  custom: TCustom | null;
}
