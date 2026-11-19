import type { MetadataExtractor } from '@ai-sdk/openai-compatible';
import type { JSONObject } from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from '@hono/zod-openapi';
import type { ProviderMetadata } from 'ai';
import { type ThinkingBlockUnion, ThinkingBlockUnionSchema } from './LLMTypes';

/**
 * Namespace the extracted blocks travel under. Ours alone: the adapter keys its own metadata by
 * provider name, so a distinct key keeps the two from overwriting each other for any provider.
 */
const THINKING_METADATA_KEY = 'trueforgeThinking';

/** Metadata field holding the signed blocks. Snake_case mirrors the gateway's own wire field. */
const THINKING_BLOCKS_FIELD = 'thinking_blocks';

/**
 * Redacted blocks sit in the same array as plain ones, so the union is required: rejecting them
 * would discard the signed blocks beside them and leave replay unsigned again.
 */
const ThinkingBlocksSchema = z.array(ThinkingBlockUnionSchema).nonempty();

/**
 * Where a gateway restates its thinking consolidated and signed: the trailing chunk of a stream,
 * or the assistant message of a non-streamed response. Earlier chunks stream the same text
 * unsigned via `reasoning_content`.
 */
const ThinkingBlocksBodySchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ thinking_blocks: ThinkingBlocksSchema.optional() }).optional(),
        message: z.object({ thinking_blocks: ThinkingBlocksSchema.optional() }).optional(),
      }),
    )
    .optional(),
});

/** Drops an absent signature rather than serializing it as `undefined`, which is not valid JSON. */
function toJsonBlock(block: ThinkingBlockUnion): JSONObject {
  if (block.type === 'redacted_thinking') {
    return { type: block.type, data: block.data };
  }
  return {
    type: block.type,
    thinking: block.thinking,
    ...(block.signature !== undefined ? { signature: block.signature } : {}),
  };
}

/**
 * Whether the gateway sent something only it can verify. Plain thinking replays fine as text, but
 * a signature or a redacted payload has to go back verbatim or the provider rejects the block.
 */
export function hasReplayableSignature(blocks: readonly ThinkingBlockUnion[]): boolean {
  return blocks.some(block => block.type === 'redacted_thinking' || block.signature !== undefined);
}

/**
 * Message-level passthrough the compatible adapter spreads verbatim onto the outbound assistant
 * message. The key is the adapter's own, fixed for every provider it serves, and it is read per
 * message rather than per content part — so replayed thinking cannot ride on the reasoning part
 * like it does for Anthropic and OpenAI.
 */
export function thinkingBlocksReplayOptions(blocks: readonly ThinkingBlockUnion[]): ProviderOptions {
  return { openaiCompatible: { [THINKING_BLOCKS_FIELD]: blocks.map(toJsonBlock) } };
}

/** Signed blocks the gateway attached to a finished stream, if it sent any. */
export function readThinkingBlocks(providerMetadata: ProviderMetadata | undefined): ThinkingBlockUnion[] | undefined {
  const parsed = ThinkingBlocksSchema.safeParse(providerMetadata?.[THINKING_METADATA_KEY]?.[THINKING_BLOCKS_FIELD]);
  return parsed.success ? [...parsed.data] : undefined;
}

/**
 * Recovers Claude's reasoning signatures from an OpenAI-compatible gateway.
 *
 * `@ai-sdk/openai-compatible` reads only `reasoning_content`, so the signature a gateway sends
 * alongside it never reaches the stream parts. Without it a replayed thinking block is unsigned,
 * and Bedrock drops it: the model loses its plan on every iteration and loops to the iteration
 * limit. The gateway's own consolidated `thinking_blocks` are taken wholesale rather than pairing
 * a loose `reasoning_signature` with an open block, which keeps interleaved thinking intact.
 *
 * Gateways that send no thinking blocks produce no metadata, so this stays inert for them.
 */
export function createThinkingBlocksMetadataExtractor(): MetadataExtractor {
  const parseBody = (body: unknown): ThinkingBlockUnion[] | undefined => {
    const parsed = ThinkingBlocksBodySchema.safeParse(body);
    if (!parsed.success) {
      return undefined;
    }
    for (const choice of parsed.data.choices ?? []) {
      const blocks = choice.delta?.thinking_blocks ?? choice.message?.thinking_blocks;
      if (blocks !== undefined) {
        return [...blocks];
      }
    }
    return undefined;
  };

  const buildFrom = (blocks: ThinkingBlockUnion[] | undefined): ProviderMetadata | undefined =>
    blocks === undefined
      ? undefined
      : { [THINKING_METADATA_KEY]: { [THINKING_BLOCKS_FIELD]: blocks.map(toJsonBlock) } };

  return {
    extractMetadata: ({ parsedBody }) => Promise.resolve(buildFrom(parseBody(parsedBody))),
    createStreamExtractor: () => {
      let blocks: ThinkingBlockUnion[] | undefined;
      return {
        processChunk: (parsedChunk: unknown): void => {
          blocks = parseBody(parsedChunk) ?? blocks;
        },
        buildMetadata: () => buildFrom(blocks),
      };
    },
  };
}
