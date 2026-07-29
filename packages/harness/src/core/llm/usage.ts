import type { CompletionUsage, GatewayChatCompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

// normalize usage to the harness shape
export function normalizeUsage(usage: GatewayChatCompletionUsage): CompletionUsage {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    cost_in_USD: usage.costInUSD ?? 0,
  };
}

export function mergeUsage(a: CompletionUsage, b: CompletionUsage): CompletionUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0),
    cache_write_tokens: (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0),
    cost_in_USD: (a.cost_in_USD ?? 0) + (b.cost_in_USD ?? 0),
  };
}
