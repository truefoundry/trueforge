import type { CompletionUsage } from '../llm/LLMTypes';

/**
 * Live — context budget for the next LLM call (not billable).
 *
 * Keeps the legacy `prompt_tokens`/`completion_tokens` names on purpose: this shape is
 * persisted per thread and carried forward across turns, so renaming it to input/output
 * would make already-stored rows load as missing fields. Public contracts (CompletionUsage,
 * AgentThreadMetrics, SSE) use input/output — translate at the boundary, never here.
 */
export interface CurrentContextUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function getEmptyCurrentContextUsage(): CurrentContextUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

export function mergeCurrentContextUsage(a: CurrentContextUsage, b: CurrentContextUsage): CurrentContextUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

/** Project per-call billable usage onto the live context budget fields. */
export function currentContextUsageFromCompletion(usage: CompletionUsage): CurrentContextUsage {
  return {
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}
