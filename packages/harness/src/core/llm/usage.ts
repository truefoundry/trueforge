import type { CompletionUsage, GatewayChatCompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

export function normalizeUsage(usage: GatewayChatCompletionUsage): CompletionUsage {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens,
    cost_in_USD: usage.costInUSD,
  };
}

export function mergeUsage(a: CompletionUsage, b: GatewayChatCompletionUsage | CompletionUsage): CompletionUsage {
  const gateway = b as GatewayChatCompletionUsage;
  const normalized = b as CompletionUsage;
  const cacheReadTokens =
    normalized.cache_read_tokens ?? gateway.cache_read_input_tokens ?? gateway.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = normalized.reasoning_tokens ?? gateway.completion_tokens_details?.reasoning_tokens;
  const costInUSD = normalized.cost_in_USD ?? gateway.costInUSD;

  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: (a.cache_read_tokens ?? 0) + (cacheReadTokens ?? 0),
    reasoning_tokens: (a.reasoning_tokens ?? 0) + (reasoningTokens ?? 0),
    cost_in_USD: (a.cost_in_USD ?? 0) + (costInUSD ?? 0),
  };
}
