import type { MCPServerInitInfo } from '../../core/events/schema';
import type { AgentThreadSnapshot } from '../../core/runtime/AgentThread.types';
import type { SandboxInfo } from '../../core/sandbox/Sandbox';
import type { TurnInputItem, TurnState } from '../schemas/turn';

/** Root thread id for every session. */
export const MAIN_THREAD_ID = 'main';

/**
 * Public wire / store shape — JSON-friendly `Record`, not `Map`, so every
 * backend can persist it directly. In-process runtime may still use Map;
 * adapt at the store/Session boundary.
 */
export interface TurnSnapshot {
  threads: Record<string, AgentThreadSnapshot>;
  mcp_servers: Record<string, MCPServerInitInfo> | null;
  sandbox_info: SandboxInfo | null;
}

export interface TurnRecord<TCustom extends object = Record<string, never>> {
  turn_id: string;
  session_id: string;
  first_turn_id: string;
  /**
   * Newest-last list of recent ancestor turn ids. Writers may truncate to a
   * recent window; this need not reach the session root. Store readers that
   * need the full chain spill through older turns' own `ancestor_ids`.
   */
  ancestor_ids: string[];
  previous_turn_id: string | null;
  state: TurnState;
  input: TurnInputItem[];
  snapshot: TurnSnapshot;
  /** Instant the turn was created (store domain). Wire/API serialize as ISO-8601. */
  created_at: Date;
  /** Instant the turn was last updated (store domain). Wire/API serialize as ISO-8601. */
  updated_at: Date;
  custom: TCustom | null;
}
