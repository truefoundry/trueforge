import type { MetadataExtractor } from '@ai-sdk/openai-compatible';
import type { JSONObject } from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from '@hono/zod-openapi';
import type { ProviderMetadata } from 'ai';
import { type ThinkingBlock, ThinkingBlockSchema } from './LLMTypes';

/**
 * Namespace the extracted blocks travel under, matching the `name` the compatible client is built
 * with so they land beside the adapter's own metadata.
 */
const TRUEFOUNDRY_METADATA_KEY = 'truefoundry';

/** Metadata field holding the signed blocks. Snake_case mirrors the gateway's own wire field. */
const THINKING_BLOCKS_FIELD = 'thinking_blocks';

const ThinkingBlocksSchema = z.array(ThinkingBlockSchema).nonempty();

/**
 * Where the gateway restates its thinking consolidated and signed: the trailing chunk of a stream,
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

/** Drops absent signatures rather than serializing them as `undefined`, which is not valid JSON. */
function toJsonBlocks(blocks: readonly ThinkingBlock[]): JSONObject[] {
  return blocks.map(block => ({
    type: block.type,
    thinking: block.thinking,
    ...(block.signature !== undefined ? { signature: block.signature } : {}),
  }));
}

/**
 * Message-level passthrough the compatible adapter spreads verbatim onto the outbound assistant
 * message. The key is the adapter's own, not the provider name, and it is read per message rather
 * than per content part — so replayed thinking cannot ride on the reasoning part like it does for
 * Anthropic and OpenAI.
 */
export function trueFoundryReplayOptions(blocks: readonly ThinkingBlock[]): ProviderOptions {
  return { openaiCompatible: { [THINKING_BLOCKS_FIELD]: toJsonBlocks(blocks) } };
}

/** Signed blocks the gateway attached to a finished stream, if it sent any. */
export function readTrueFoundryThinkingBlocks(
  providerMetadata: ProviderMetadata | undefined,
): ThinkingBlock[] | undefined {
  const parsed = ThinkingBlocksSchema.safeParse(providerMetadata?.[TRUEFOUNDRY_METADATA_KEY]?.[THINKING_BLOCKS_FIELD]);
  return parsed.success ? [...parsed.data] : undefined;
}

/**
 * Recovers Claude's reasoning signatures from the TrueFoundry gateway.
 *
 * `@ai-sdk/openai-compatible` reads only `reasoning_content`, so the signature the gateway sends
 * alongside it never reaches the stream parts. Without it a replayed thinking block is unsigned,
 * and Bedrock drops it: the model loses its plan on every iteration and loops to the iteration
 * limit. The gateway's own consolidated `thinking_blocks` are taken wholesale rather than pairing
 * a loose `reasoning_signature` with an open block, which keeps interleaved thinking intact.
 */
export function createTrueFoundryMetadataExtractor(): MetadataExtractor {
  const parseBody = (body: unknown): ThinkingBlock[] | undefined => {
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

  const buildFrom = (blocks: ThinkingBlock[] | undefined): ProviderMetadata | undefined =>
    blocks === undefined
      ? undefined
      : { [TRUEFOUNDRY_METADATA_KEY]: { [THINKING_BLOCKS_FIELD]: toJsonBlocks(blocks) } };

  return {
    extractMetadata: ({ parsedBody }) => Promise.resolve(buildFrom(parseBody(parsedBody))),
    createStreamExtractor: () => {
      let blocks: ThinkingBlock[] | undefined;
      return {
        processChunk: (parsedChunk: unknown): void => {
          blocks = parseBody(parsedChunk) ?? blocks;
        },
        buildMetadata: () => buildFrom(blocks),
      };
    },
  };
}
