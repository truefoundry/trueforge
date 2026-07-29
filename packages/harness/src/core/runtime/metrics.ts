export interface AgentThreadMetrics {
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cost_in_usd: number;
  iterations: number;
  total_tool_calls: number;
  total_summarizations: number;
  total_sub_agents: number;
}

export function createEmptyAgentThreadMetrics(): AgentThreadMetrics {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cost_in_usd: 0,
    iterations: 0,
    total_tool_calls: 0,
    total_summarizations: 0,
    total_sub_agents: 0,
  };
}

/** In-place zero of all fields (for turn-scoped buckets that must not leak across executes). */
export function clearAgentThreadMetrics(target: AgentThreadMetrics): void {
  Object.assign(target, createEmptyAgentThreadMetrics());
}

export function addAgentThreadMetrics(target: AgentThreadMetrics, source: AgentThreadMetrics): void {
  target.iterations += source.iterations;
  target.total_tool_calls += source.total_tool_calls;
  target.total_summarizations += source.total_summarizations;
  target.total_sub_agents += source.total_sub_agents;
  target.prompt_tokens += source.prompt_tokens;
  target.completion_tokens += source.completion_tokens;
  target.cache_read_tokens += source.cache_read_tokens;
  target.cost_in_usd += source.cost_in_usd;
}
