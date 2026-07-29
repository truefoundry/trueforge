import { getEmptyUsage, type CompletionUsage } from '../llm/LLMTypes';

export interface AgentThreadMetrics extends CompletionUsage {
  iterations: number;
  total_tool_calls: number;
  total_summarizations: number;
  total_sub_agents: number;
}

export function createEmptyAgentThreadMetrics(): AgentThreadMetrics {
  return {
    ...getEmptyUsage(),
    iterations: 0,
    total_tool_calls: 0,
    total_summarizations: 0,
    total_sub_agents: 0,
  };
}

export function addAgentThreadMetrics(target: AgentThreadMetrics, source: AgentThreadMetrics): void {
  target.iterations += source.iterations;
  target.total_tool_calls += source.total_tool_calls;
  target.total_summarizations += source.total_summarizations;
  target.total_sub_agents += source.total_sub_agents;
  target.prompt_tokens += source.prompt_tokens;
  target.completion_tokens += source.completion_tokens;
  target.cache_read_tokens = (target.cache_read_tokens ?? 0) + (source.cache_read_tokens ?? 0);
  target.cache_write_tokens = (target.cache_write_tokens ?? 0) + (source.cache_write_tokens ?? 0);
  target.reasoning_tokens = (target.reasoning_tokens ?? 0) + (source.reasoning_tokens ?? 0);
  target.cost_in_USD = (target.cost_in_USD ?? 0) + (source.cost_in_USD ?? 0);
  target.total_tokens += source.total_tokens;
}
