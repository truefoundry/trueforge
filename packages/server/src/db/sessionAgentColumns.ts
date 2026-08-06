import type { AgentSpec, SessionAgent } from '@truefoundry/utils-core/agent-session';

/** Flatten domain agent for SQL session columns (XOR pair). */
export function sessionAgentToColumns(agent: SessionAgent): {
  agent_id: string | null;
  agent_spec: AgentSpec | null;
} {
  if (agent.type === 'ref') {
    return { agent_id: agent.agent_id, agent_spec: null };
  }
  return { agent_id: null, agent_spec: agent.agent_spec };
}

/** Rebuild domain agent from SQL session columns. */
export function sessionAgentFromColumns(input: {
  session_id: string;
  agent_id: string | null;
  agent_spec: AgentSpec | null;
}): SessionAgent {
  if (input.agent_id !== null && input.agent_spec === null) {
    return { type: 'ref', agent_id: input.agent_id };
  }
  if (input.agent_id === null && input.agent_spec !== null) {
    return { type: 'value', agent_spec: input.agent_spec };
  }
  throw new Error(
    `Session ${input.session_id} has invalid agent binding (exactly one of agent_id or agent_spec required)`,
  );
}
