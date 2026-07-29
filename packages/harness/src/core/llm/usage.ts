import { getEmptyUsage, type CompletionUsage, type GatewayChatCompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

// Normalize usage to the harness shape.
export function normalizeUsage(usage: GatewayChatCompletionUsage | CompletionUsage): CompletionUsage {
  return mergeUsage(getEmptyUsage(), usage);
}

export function mergeUsage(a: CompletionUsage, b: GatewayChatCompletionUsage | CompletionUsage): CompletionUsage {
  const gateway = b as GatewayChatCompletionUsage;
  const normalized = b as CompletionUsage;
  const cacheReadTokens =
    normalized.cache_read_tokens ?? gateway.cache_read_input_tokens ?? gateway.prompt_tokens_details?.cached_tokens;
  const cacheWriteTokens = normalized.cache_write_tokens ?? gateway.cache_creation_input_tokens;
  const costInUSD = normalized.cost_in_USD ?? gateway.costInUSD;

  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: (a.cache_read_tokens ?? 0) + (cacheReadTokens ?? 0),
    cache_write_tokens: (a.cache_write_tokens ?? 0) + (cacheWriteTokens ?? 0),
    cost_in_USD: (a.cost_in_USD ?? 0) + (costInUSD ?? 0),
  };
}
