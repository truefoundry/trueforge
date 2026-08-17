import { z } from '@hono/zod-openapi';
import type { CompletionUsage } from '../llm/LLMTypes';

/** Billable aggregate — thread/orchestrator totals (`total_*`). */
export const AgentThreadMetricsSchema = z
  .object({
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    total_cache_read_tokens: z.number().int().nonnegative().optional(),
    total_cache_write_tokens: z.number().int().nonnegative().optional(),
    total_reasoning_tokens: z.number().int().nonnegative().optional(),
    total_cost_in_usd: z.number().nonnegative().optional(),
    iterations: z.number().int().nonnegative(),
    total_tool_calls: z.number().int().nonnegative(),
    total_summarizations: z.number().int().nonnegative(),
    total_sub_agents: z.number().int().nonnegative(),
  })
  .openapi('AgentThreadMetrics');

export type AgentThreadMetrics = z.infer<typeof AgentThreadMetricsSchema>;

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) {
    return undefined;
  }
  return (a ?? 0) + (b ?? 0);
}

export function createEmptyAgentThreadMetrics(): AgentThreadMetrics {
  return {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    iterations: 0,
    total_tool_calls: 0,
    total_summarizations: 0,
    total_sub_agents: 0,
  };
}

/** Fold one per-call completion usage into aggregated thread metrics. */
export function updateMetricsFromUsage(target: AgentThreadMetrics, usage: CompletionUsage): void {
  target.total_input_tokens += usage.input_tokens;
  target.total_output_tokens += usage.output_tokens;
  target.total_tokens += usage.total_tokens;
  target.total_cache_read_tokens = sumOptional(target.total_cache_read_tokens, usage.cache_read_tokens);
  target.total_cache_write_tokens = sumOptional(target.total_cache_write_tokens, usage.cache_write_tokens);
  target.total_reasoning_tokens = sumOptional(target.total_reasoning_tokens, usage.reasoning_tokens);
  target.total_cost_in_usd = sumOptional(target.total_cost_in_usd, usage.cost_in_usd);
}

export function addAgentThreadMetrics(target: AgentThreadMetrics, source: AgentThreadMetrics): void {
  target.total_input_tokens += source.total_input_tokens;
  target.total_output_tokens += source.total_output_tokens;
  target.total_tokens += source.total_tokens;
  target.total_cache_read_tokens = sumOptional(target.total_cache_read_tokens, source.total_cache_read_tokens);
  target.total_cache_write_tokens = sumOptional(target.total_cache_write_tokens, source.total_cache_write_tokens);
  target.total_reasoning_tokens = sumOptional(target.total_reasoning_tokens, source.total_reasoning_tokens);
  target.total_cost_in_usd = sumOptional(target.total_cost_in_usd, source.total_cost_in_usd);
  target.iterations += source.iterations;
  target.total_tool_calls += source.total_tool_calls;
  target.total_summarizations += source.total_summarizations;
  target.total_sub_agents += source.total_sub_agents;
}
