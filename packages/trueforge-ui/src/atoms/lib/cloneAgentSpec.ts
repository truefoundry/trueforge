import type { AgentSpec } from '../../server/types.js';

/** Shallow-clone an agent spec for create/update draft forms. */
export function cloneAgentSpec(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    model: {
      ...spec.model,
      params: spec.model.params ? { ...spec.model.params } : undefined,
    },
    mcpServers: spec.mcpServers?.map((item: object) => ({ ...item })),
    skills: spec.skills?.map((item: object) => ({ ...item })),
    config: spec.config ? { ...spec.config } : undefined,
  };
}
