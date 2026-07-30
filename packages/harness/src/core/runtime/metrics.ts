import { z } from '@hono/zod-openapi';
import type { CompletionUsage } from '../llm/LLMTypes';

/**
 * Billable / aggregated metrics for one AgentThread.
 * Orchestrator rollups reuse this same schema (sum of thread metrics).
 *
 * Every usage field is `total_*` so it cannot be confused with per-call CompletionUsage.
 * Does not include input_tokens_breakdown (that stays on live model-message usage only).
 */
export const AgentThreadMetricsSchema = z
  .object({
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    total_cache_read_tokens: z.number().int().nonnegative(),
    total_cache_write_tokens: z.number().int().nonnegative(),
    total_reasoning_tokens: z.number().int().nonnegative(),
    total_cost_in_usd: z.number().nonnegative(),
    iterations: z.number().int().nonnegative(),
    total_tool_calls: z.number().int().nonnegative(),
    total_summarizations: z.number().int().nonnegative(),
    total_sub_agents: z.number().int().nonnegative(),
  })
  .openapi('AgentThreadMetrics');

export type AgentThreadMetrics = z.infer<typeof AgentThreadMetricsSchema>;

export function createEmptyAgentThreadMetrics(): AgentThreadMetrics {
  return {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_write_tokens: 0,
    total_reasoning_tokens: 0,
    total_cost_in_usd: 0,
    iterations: 0,
    total_tool_calls: 0,
    total_summarizations: 0,
    total_sub_agents: 0,
  };
}

/** Map accumulated per-call usage onto the aggregated metrics shape. */
export function agentThreadMetricsFromUsage(
  usage: CompletionUsage,
  counters: {
    iterations: number;
    total_tool_calls: number;
    total_summarizations: number;
    total_sub_agents: number;
  },
): AgentThreadMetrics {
  return {
    total_input_tokens: usage.input_tokens,
    total_output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    total_cache_read_tokens: usage.cache_read_tokens ?? 0,
    total_cache_write_tokens: usage.cache_write_tokens ?? 0,
    total_reasoning_tokens: usage.reasoning_tokens ?? 0,
    total_cost_in_usd: usage.cost_in_usd ?? 0,
    iterations: counters.iterations,
    total_tool_calls: counters.total_tool_calls,
    total_summarizations: counters.total_summarizations,
    total_sub_agents: counters.total_sub_agents,
  };
}

export function addAgentThreadMetrics(target: AgentThreadMetrics, source: AgentThreadMetrics): void {
  target.total_input_tokens += source.total_input_tokens;
  target.total_output_tokens += source.total_output_tokens;
  target.total_tokens += source.total_tokens;
  target.total_cache_read_tokens += source.total_cache_read_tokens;
  target.total_cache_write_tokens += source.total_cache_write_tokens;
  target.total_reasoning_tokens += source.total_reasoning_tokens;
  target.total_cost_in_usd += source.total_cost_in_usd;
  target.iterations += source.iterations;
  target.total_tool_calls += source.total_tool_calls;
  target.total_summarizations += source.total_summarizations;
  target.total_sub_agents += source.total_sub_agents;
}
