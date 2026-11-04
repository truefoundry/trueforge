import type { LLMCreateParamsStreaming } from './ILLM';
import type { CompletionUsage } from './LLMTypes';

export function estimateTokensForString(s: string): number {
  return s.length / 4;
}

/** Size label for prompts replacing full content, so the model can size reads without guessing. */
export function describeContentSize(content: string): string {
  return `${String(content.length)} characters`;
}

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) {
    return undefined;
  }
  return (a ?? 0) + (b ?? 0);
}

export function mergeUsage(a: CompletionUsage, b: CompletionUsage): CompletionUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: sumOptional(a.cache_read_tokens, b.cache_read_tokens),
    cache_write_tokens: sumOptional(a.cache_write_tokens, b.cache_write_tokens),
    reasoning_tokens: sumOptional(a.reasoning_tokens, b.reasoning_tokens),
    cost_in_usd: sumOptional(a.cost_in_usd, b.cost_in_usd),
  };
}

/** Prefers `max_completion_tokens`, falling back to the deprecated `max_tokens`. */
export function resolveMaxOutputTokens(
  body: Pick<LLMCreateParamsStreaming, 'max_completion_tokens'>,
): number | undefined {
  const limit: unknown = body.max_completion_tokens ?? Reflect.get(body, 'max_tokens');
  return typeof limit === 'number' ? limit : undefined;
}
