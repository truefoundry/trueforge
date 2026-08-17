import { z } from '@hono/zod-openapi';
import type { CompletionUsage } from '../llm/LLMTypes';

/**
 * Live context budget for the next LLM call (not billable). The legacy
 * `prompt_tokens`/`completion_tokens` names are load-bearing: this shape is persisted per
 * thread, so renaming them would make already-stored rows load as missing fields.
 */
export const CurrentContextUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().describe('Live prompt-side context tokens for the next LLM call.'),
    completion_tokens: z
      .number()
      .int()
      .nonnegative()
      .describe('Live completion-side context tokens for the next LLM call.'),
  })
  .openapi('CurrentContextUsage');

export type CurrentContextUsage = z.infer<typeof CurrentContextUsageSchema>;

export function getEmptyCurrentContextUsage(): CurrentContextUsage {
  return { prompt_tokens: 0, completion_tokens: 0 };
}

export function mergeCurrentContextUsage(a: CurrentContextUsage, b: CurrentContextUsage): CurrentContextUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
  };
}

/** Project per-call billable usage onto the live context budget fields. */
export function currentContextUsageFromCompletion(usage: CompletionUsage): CurrentContextUsage {
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
  };
}
