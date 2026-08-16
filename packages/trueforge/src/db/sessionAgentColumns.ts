import { AgentSpecSchema, type AgentSpec, type SessionAgent } from '@truefoundry/trueforge-core/agent-session';

/** Flatten domain agent for SQL session columns (XOR agent_id / agent_spec; optional name snapshot). */
export function sessionAgentToColumns(agent: SessionAgent): {
  agent_id: string | null;
  agent_name: string | null;
  agent_spec: AgentSpec | null;
} {
  if (agent.type === 'reference') {
    return { agent_id: agent.id, agent_name: agent.name, agent_spec: null };
  }
  return { agent_id: null, agent_name: null, agent_spec: agent.spec };
}

/** Rebuild domain agent from SQL session columns. */
export function sessionAgentFromColumns(input: {
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_spec: AgentSpec | null;
}): SessionAgent {
  if (input.agent_id !== null && input.agent_spec === null) {
    return { type: 'reference', id: input.agent_id, name: input.agent_name };
  }
  if (input.agent_id === null && input.agent_spec !== null) {
    // Re-parse so schema defaults apply to inline specs persisted before a config field existed.
    return { type: 'inline', spec: AgentSpecSchema.parse(input.agent_spec) };
  }
  throw new Error(
    `Session ${input.session_id} has invalid agent binding (exactly one of agent_id or agent_spec required)`,
  );
}
