/**
 * Chunk shapes here are taken from a live TrueFoundry gateway stream
 * (`tfy-ai-features/claude-sonnet-5`, Claude with extended thinking): reasoning streams unsigned
 * via `reasoning_content`, a standalone `reasoning_signature` follows, and the consolidated
 * `thinking_blocks` arrive last.
 */
import {
  createTrueFoundryMetadataExtractor,
  hasReplayableSignature,
  readTrueFoundryThinkingBlocks,
  trueFoundryReplayOptions,
} from '../../../src/core/llm/truefoundryReasoning';

const SIGNATURE = 'EuMDCpoCCBMQAhgCKkDSGVGyihyHKHDqnG1nmn7RXijiC9ntHRt4sY55B51a';
const THINKING = "I'll just go ahead and call get_current_datetime now.";

function reasoningDelta(text: string): unknown {
  return { choices: [{ index: 0, delta: { reasoning_content: text } }] };
}

function signatureDelta(): unknown {
  return { choices: [{ index: 0, delta: { reasoning_signature: SIGNATURE } }] };
}

function thinkingBlocksDelta(blocks: unknown): unknown {
  return { choices: [{ index: 0, delta: { thinking_blocks: blocks } }] };
}

describe('TrueFoundry metadata extractor', () => {
  it('captures the consolidated thinking blocks from the trailing chunk', () => {
    const extractor = createTrueFoundryMetadataExtractor().createStreamExtractor();

    extractor.processChunk({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
    extractor.processChunk(reasoningDelta("I'll just go ahead "));
    extractor.processChunk(reasoningDelta('and call get_current_datetime now.'));
    extractor.processChunk(signatureDelta());
    extractor.processChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1' }] } }] });
    extractor.processChunk(thinkingBlocksDelta([{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }]));

    expect(extractor.buildMetadata()).toEqual({
      truefoundry: { thinking_blocks: [{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }] },
    });
  });

  it('keeps every block when the model interleaves thinking', () => {
    const extractor = createTrueFoundryMetadataExtractor().createStreamExtractor();
    extractor.processChunk(
      thinkingBlocksDelta([
        { type: 'thinking', thinking: 'first', signature: 'sig-1' },
        { type: 'thinking', thinking: 'second', signature: 'sig-2' },
      ]),
    );

    expect(readTrueFoundryThinkingBlocks(extractor.buildMetadata())).toEqual([
      { type: 'thinking', thinking: 'first', signature: 'sig-1' },
      { type: 'thinking', thinking: 'second', signature: 'sig-2' },
    ]);
  });

  it('builds no metadata for a stream that never sends thinking blocks', () => {
    const extractor = createTrueFoundryMetadataExtractor().createStreamExtractor();
    extractor.processChunk(reasoningDelta('thinking without a signature'));
    extractor.processChunk(signatureDelta());

    expect(extractor.buildMetadata()).toBeUndefined();
  });

  it('ignores malformed or empty thinking blocks rather than throwing', () => {
    const extractor = createTrueFoundryMetadataExtractor().createStreamExtractor();
    extractor.processChunk('not an object');
    extractor.processChunk({ choices: 'wrong type' });
    extractor.processChunk(thinkingBlocksDelta([]));
    extractor.processChunk(thinkingBlocksDelta([{ type: 'something_else', whatever: true }]));

    expect(extractor.buildMetadata()).toBeUndefined();
  });

  it('keeps signed blocks that share an array with a redacted one', () => {
    const extractor = createTrueFoundryMetadataExtractor().createStreamExtractor();
    extractor.processChunk(
      thinkingBlocksDelta([
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'thinking', thinking: THINKING, signature: SIGNATURE },
      ]),
    );

    // Rejecting the redacted entry would take the signed block with it and unsign the replay.
    expect(readTrueFoundryThinkingBlocks(extractor.buildMetadata())).toEqual([
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'thinking', thinking: THINKING, signature: SIGNATURE },
    ]);
  });

  it('reads thinking blocks from a non-streamed response body', async () => {
    const metadata = await createTrueFoundryMetadataExtractor().extractMetadata({
      parsedBody: {
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              thinking_blocks: [{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }],
            },
          },
        ],
      },
    });

    expect(readTrueFoundryThinkingBlocks(metadata)).toEqual([
      { type: 'thinking', thinking: THINKING, signature: SIGNATURE },
    ]);
  });
});

describe('readTrueFoundryThinkingBlocks', () => {
  it('returns undefined for metadata from any other provider', () => {
    expect(readTrueFoundryThinkingBlocks(undefined)).toBeUndefined();
    expect(readTrueFoundryThinkingBlocks({ anthropic: { signature: SIGNATURE } })).toBeUndefined();
    expect(readTrueFoundryThinkingBlocks({ truefoundry: { cache_control: { type: 'ephemeral' } } })).toBeUndefined();
  });
});

describe('hasReplayableSignature', () => {
  it('is true for a signature and for a redacted payload, false for bare thinking', () => {
    expect(hasReplayableSignature([{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }])).toBe(true);
    expect(hasReplayableSignature([{ type: 'redacted_thinking', data: 'opaque' }])).toBe(true);
    expect(hasReplayableSignature([{ type: 'thinking', thinking: THINKING }])).toBe(false);
    expect(hasReplayableSignature([])).toBe(false);
  });
});

describe('trueFoundryReplayOptions', () => {
  it('serializes redacted blocks alongside signed ones, in order', () => {
    const options = trueFoundryReplayOptions([
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'thinking', thinking: THINKING, signature: SIGNATURE },
    ]);

    expect(options['openaiCompatible']?.['thinking_blocks']).toEqual([
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'thinking', thinking: THINKING, signature: SIGNATURE },
    ]);
  });

  it('uses the adapter passthrough key rather than the provider name', () => {
    const options = trueFoundryReplayOptions([{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }]);

    expect(options).toEqual({
      openaiCompatible: { thinking_blocks: [{ type: 'thinking', thinking: THINKING, signature: SIGNATURE }] },
    });
  });

  it('omits an absent signature instead of serializing undefined', () => {
    const options = trueFoundryReplayOptions([{ type: 'thinking', thinking: THINKING }]);

    expect(options['openaiCompatible']?.['thinking_blocks']).toEqual([{ type: 'thinking', thinking: THINKING }]);
    expect(JSON.stringify(options)).not.toContain('signature');
  });
});
