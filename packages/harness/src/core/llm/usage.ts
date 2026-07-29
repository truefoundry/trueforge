import type { CompletionUsage, GatewayCompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

/** Convert gateway/OpenAI usage into the flat provider-agnostic harness shape. */
export function normalizeCompletionUsage(usage: GatewayCompletionUsage): CompletionUsage {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    cost_in_usd: usage.costInUSD ?? 0,
  };
}

export function mergeUsage(a: CompletionUsage, b: CompletionUsage): CompletionUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0),
    reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    cost_in_usd: (a.cost_in_usd ?? 0) + (b.cost_in_usd ?? 0),
  };
}
