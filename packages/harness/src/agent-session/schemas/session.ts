/**
 * Internal session agent binding persisted by stores and consumed at runtime.
 * Untrusted input is validated by the public wire schemas, never here.
 */
import type { AgentSpec } from './agentSpec';

/** Named registry binding or inline draft spec — exactly one arm. */
export type SessionAgent = { type: 'ref'; agent_id: string } | { type: 'value'; agent_spec: AgentSpec };
