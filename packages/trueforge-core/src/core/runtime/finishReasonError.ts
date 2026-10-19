import type { FinishReason } from '../llm/LLMTypes';

/**
 * User-facing error for finish reasons that should fail the turn; undefined lets it continue or finish.
 * Messages follow `<Headline>: <what happened>. <what the user can do>.`
 */
export function finishReasonErrorMessage({
  finishReason,
  outputTokens,
  maxOutputTokens,
}: {
  finishReason: FinishReason | null;
  outputTokens: number;
  maxOutputTokens: number | undefined;
}): string | undefined {
  switch (finishReason) {
    case 'length': {
      const limit =
        maxOutputTokens !== undefined
          ? `the ${String(maxOutputTokens)} token limit`
          : "the provider's default token limit";
      // 0 means the provider omitted usage; a count equal to the limit adds nothing.
      const used = outputTokens > 0 && outputTokens !== maxOutputTokens ? ` after ${String(outputTokens)} tokens` : '';
      return `Output truncated: hit ${limit}${used}. Raise max_tokens and retry.`;
    }
    case 'stop':
    case 'tool_calls':
    case 'function_call':
    case 'content_filter':
    case null:
      return undefined;
    default: {
      const unhandled: never = finishReason;
      throw new Error(`Unhandled finish reason: ${String(unhandled)}`);
    }
  }
}
