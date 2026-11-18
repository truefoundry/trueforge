import type { AgentSpec } from '../../server/types.js';

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)));
  });
}

// Runtime toggles in `config` (sandbox, web search, memory) are reconciled against server
// capabilities on mount, so including them would flag a builder the user never touched.
function userEditableFields(spec: AgentSpec) {
  return {
    model: spec.model,
    instructions: spec.instructions ?? '',
    mcpServers: spec.mcpServers ?? [],
    skills: spec.skills ?? [],
  };
}

/** True when `live` differs from `saved` in a field the user edits in the agent builder. */
export function hasAgentSpecEdits({ saved, live }: { saved: AgentSpec; live: AgentSpec }): boolean {
  return stableStringify(userEditableFields(saved)) !== stableStringify(userEditableFields(live));
}
