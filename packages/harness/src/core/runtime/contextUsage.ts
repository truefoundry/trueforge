import type { CurrentContextUsage } from '../events/schema';
import type { CompletionUsage } from '../llm/LLMTypes';

export function getEmptyCurrentContextUsage(): CurrentContextUsage {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

export function mergeCurrentContextUsage(a: CurrentContextUsage, b: CurrentContextUsage): CurrentContextUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

/** Project per-call billable usage onto the live context budget fields. */
export function currentContextUsageFromCompletion(usage: CompletionUsage): CurrentContextUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
}
