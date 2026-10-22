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
    case 'content_filter':
      return "Output blocked: the model's content safety filter stopped the response. Rephrase the request and retry.";
    default:
      return undefined;
  }
}
