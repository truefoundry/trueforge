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
  mcp_servers?: Record<string, MCPServerInitInfo> | undefined;
  sandbox_info?: SandboxInfo | undefined;
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
  previous_turn_id?: string | undefined;
  state: TurnState;
  input: TurnInputItem[];
  snapshot: TurnSnapshot;
  /** ISO-8601 UTC datetime string (for example, `2026-07-24T02:45:00.000Z`). */
  created_at: string;
  /** ISO-8601 UTC datetime string (for example, `2026-07-24T02:45:00.000Z`). */
  updated_at: string;
  custom?: TCustom | undefined;
}
