import type { CompletionUsage } from '../llm/LLMTypes';

/** Live — context budget for the next LLM call (not billable). */
export interface CurrentContextUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

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
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}
