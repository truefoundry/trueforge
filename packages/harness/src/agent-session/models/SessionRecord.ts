import type { AgentSpec } from '../schemas/agentSpec';
import type { SessionAgentSource } from '../schemas/session';

/**
 * Session persistence record. Agent binding is **agent_id XOR agent_spec**
 * (exactly one non-null). Named agents are resolved live at turn time — the
 * store does not hydrate agent_spec from agent_id on read.
 */
export interface SessionRecord<TCustom extends object = Record<string, never>> {
  tenant_id: string;
  session_id: string;
  /** Named registry binding; */
  agent_id: string | null;
  /** Inline draft binding; */
  agent_spec: AgentSpec | null;
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

/** Derive the turn-time agent source from a persisted session row. */
export function sessionAgentSource<TCustom extends object>(record: SessionRecord<TCustom>): SessionAgentSource {
  if (record.agent_id !== null && record.agent_spec === null) {
    return { type: 'named', agent_id: record.agent_id };
  }
  if (record.agent_id === null && record.agent_spec !== null) {
    return { type: 'inline', agent_spec: record.agent_spec };
  }
  throw new Error(
    `Session ${record.session_id} has invalid agent binding (only one of agent_id or agent_spec required)`,
  );
}
