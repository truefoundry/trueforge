import type { AnalyticsEventProps } from './types.js';

/**
 * Attach session and agent identity to an event when the shell actually has it.
 * Null, undefined, and empty strings are omitted so a new chat (no session yet)
 * or an unnamed draft does not send blank `session_id` / `agent_id` to the host.
 */
export function withSessionProps(
  base: AnalyticsEventProps | undefined,
  session: { sessionId?: string | null; agentId?: string | null; agentName?: string | null },
): AnalyticsEventProps {
  return {
    ...base,
    ...(session.sessionId != null && session.sessionId !== '' ? { session_id: session.sessionId } : {}),
    ...(session.agentId != null && session.agentId !== '' ? { agent_id: session.agentId } : {}),
    ...(session.agentName != null && session.agentName !== '' ? { agent_name: session.agentName } : {}),
  };
}
