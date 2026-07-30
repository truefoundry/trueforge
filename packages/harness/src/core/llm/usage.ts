import type { CompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

export function mergeUsage(a: CompletionUsage, b: CompletionUsage): CompletionUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0),
    cache_write_tokens: (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0),
    reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    cost_in_usd: (a.cost_in_usd ?? 0) + (b.cost_in_usd ?? 0),
  };
}
