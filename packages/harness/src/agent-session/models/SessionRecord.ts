import type { SessionAgent } from '../schemas/session';

/**
 * Session persistence record. Agent binding is a single discriminated `agent`
 * (`ref` | `value`). Named agents are not hydrated on read.
 */
export interface SessionRecord<TCustom extends object = Record<string, never>> {
  tenant_id: string;
  session_id: string;
  /** Caller identity that created the session (immutable after create). */
  created_by: string;
  agent: SessionAgent;
  /**
   * Wire SessionSchema.title (nullable). Written via updateSession patch or
   * createTurn's update_session_title_if_not_exist (first write wins; caller derives).
   */
  title: string | null;
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
  custom: TCustom | null;
}
