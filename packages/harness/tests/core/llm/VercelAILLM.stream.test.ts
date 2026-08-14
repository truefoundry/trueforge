/**
 * Stream processing: usage/finish-reason normalisation and the
 * TextStreamPart → ExtendedChatCompletionChunk mapper.
 */
import type {
  FinishReason,
  LanguageModelUsage,
  ProviderMetadata,
  StepResultPerformance,
  TextStreamPart,
  ToolSet,
} from 'ai';
import { APICallError } from 'ai';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import {
  describeStreamError,
  mapFinishReason,
  mapStreamToChunks,
  normalizeUsage,
  toStreamError,
} from '../../../src/core/llm/VercelAILLM';

// ─────────── Helpers ───────────

function makeUsage(inputTokens = 10, outputTokens = 5): LanguageModelUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined, noCacheTokens: undefined },
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
  };
}

function makeFinishStep(
  finishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other',
  usage: LanguageModelUsage = makeUsage(),
): TextStreamPart<ToolSet> {
  const performance: StepResultPerformance = {
    effectiveOutputTokensPerSecond: 0,
    outputTokensPerSecond: undefined,
    inputTokensPerSecond: undefined,
    effectiveTotalTokensPerSecond: 0,
    stepTimeMs: 0,
    responseTimeMs: 0,
    toolExecutionMs: {},
    timeToFirstOutputMs: undefined,
  };
  return {
    type: 'finish-step',
    response: { id: 'resp', timestamp: new Date(0), modelId: 'test-model' },
    usage,
    performance,
    finishReason,
    rawFinishReason: undefined,
    providerMetadata: undefined,
  };
}

async function* makeStream(parts: TextStreamPart<ToolSet>[]): AsyncGenerator<TextStreamPart<ToolSet>> {
  for (const part of parts) yield part;
}

async function drainStream(
  gen: AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown>,
): Promise<{ chunks: ExtendedChatCompletionChunk[]; final: RawAssistantMessageWithUsage }> {
  const chunks: ExtendedChatCompletionChunk[] = [];
  let result = await gen.next();
  while (!result.done) {
    chunks.push(result.value);
    result = await gen.next();
  }
  return { chunks, final: result.value };
}

const CHUNK_META = { id: 'test-id', created: 0, model: 'test-model' };

// ─────────── normalizeUsage ───────────

describe('normalizeUsage', () => {
  it('sums input and output tokens', () => {
    const result = normalizeUsage(makeUsage(10, 5));
    expect(result).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it('treats undefined token counts as 0', () => {
    const usage = makeUsage(0, 0);
    // Overwrite at runtime to simulate the SDK returning undefined for token counts.
    Reflect.set(usage, 'inputTokens', undefined);
    Reflect.set(usage, 'outputTokens', undefined);
    const result = normalizeUsage(usage);
    expect(result).toMatchObject({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  });

  it('maps cache and reasoning detail fields', () => {
    const usage = makeUsage(20, 10);
    usage.inputTokenDetails.cacheReadTokens = 5;
    usage.inputTokenDetails.cacheWriteTokens = 3;
    usage.outputTokenDetails.reasoningTokens = 4;
    const result = normalizeUsage(usage);
    expect(result.cache_read_tokens).toBe(5);
    expect(result.cache_write_tokens).toBe(3);
    expect(result.reasoning_tokens).toBe(4);
  });

  it('leaves optional fields as undefined when source values are absent', () => {
    const result = normalizeUsage(makeUsage());
    expect(result.cache_read_tokens).toBeUndefined();
    expect(result.cache_write_tokens).toBeUndefined();
    expect(result.reasoning_tokens).toBeUndefined();
    expect(result.cost_in_usd).toBeUndefined();
  });

  it('maps gateway costInUSD from usage.raw onto cost_in_usd', () => {
    const usage = makeUsage(10, 5);
    usage.raw = { costInUSD: 0.0042 };
    expect(normalizeUsage(usage).cost_in_usd).toBe(0.0042);
  });

  it('omits cost_in_usd when raw.costInUSD is not a nonnegative number', () => {
    const usage = makeUsage();
    usage.raw = { costInUSD: -0.01 };
    expect(normalizeUsage(usage).cost_in_usd).toBeUndefined();
  });
});

// ─────────── mapFinishReason ───────────

describe('mapFinishReason', () => {
  const cases: Array<[FinishReason, string]> = [
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool-calls', 'tool_calls'],
    ['content-filter', 'content_filter'],
    ['error', 'stop'],
    ['other', 'stop'],
  ];

  it.each(cases)('maps %s → %s', (sdkReason, harnessReason) => {
    expect(mapFinishReason(sdkReason)).toBe(harnessReason);
  });
});

// ─────────── describeStreamError ───────────

describe('describeStreamError', () => {
  describe('APICallError', () => {
    it.each([
      {
        provider: 'openai',
        statusCode: 401,
        message: 'Incorrect API key provided: sk-inval***********-key.',
        expected: 'Request failed (401): Incorrect API key provided: sk-inval***********-key.',
      },
      {
        provider: 'anthropic',
        statusCode: 401,
        message: 'invalid x-api-key',
        expected: 'Request failed (401): invalid x-api-key',
      },
      {
        provider: 'google-gemini',
        statusCode: 400,
        message: 'API key not valid. Please pass a valid API key.',
        expected: 'Request failed (400): API key not valid. Please pass a valid API key.',
      },
    ] as const)('includes HTTP status for $provider invalid-key failures', ({ statusCode, message, expected }) => {
      expect(
        describeStreamError(
          new APICallError({
            message,
            url: 'https://example.com',
            requestBodyValues: {},
            statusCode,
          }),
        ),
      ).toBe(expected);
    });

    it('omits status prefix when statusCode is absent', () => {
      expect(
        describeStreamError(
          new APICallError({
            message: 'upstream failed',
            url: 'https://example.com',
            requestBodyValues: {},
          }),
        ),
      ).toBe('upstream failed');
    });
  });

  describe('fallback', () => {
    it('uses Error.message', () => {
      expect(describeStreamError(new Error('upstream error'))).toBe('upstream error');
    });

    it('uses a plain object message field', () => {
      expect(describeStreamError({ message: 'The requested model does not exist.' })).toBe(
        'The requested model does not exist.',
      );
    });

    it('JSON-serialises a message-less object instead of [object Object]', () => {
      expect(describeStreamError({ code: 'model_not_found', status: 404 })).toBe(
        '{"code":"model_not_found","status":404}',
      );
    });

    it('stringifies non-object values', () => {
      expect(describeStreamError('string error')).toBe('string error');
      expect(describeStreamError(42)).toBe('42');
      expect(describeStreamError(null)).toBe('null');
    });
  });
});

describe('toStreamError', () => {
  it('returns Error instances unchanged', () => {
    const err = new Error('keep me');
    err.name = 'AbortError';
    expect(toStreamError(err)).toBe(err);
  });

  it('wraps plain objects using describeStreamError', () => {
    const wrapped = toStreamError({ message: 'The requested model does not exist.' });
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('The requested model does not exist.');
    expect(wrapped.cause).toEqual({ message: 'The requested model does not exist.' });
  });
});

// ─────────── mapStreamToChunks ───────────

describe('mapStreamToChunks', () => {
  it('emits text-delta chunks and accumulates content in the final message', async () => {
    const { chunks, final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'text-delta', id: 't1', text: 'hel' },
          { type: 'text-delta', id: 't1', text: 'lo' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const textChunks = chunks.filter(c => c.choices[0]?.delta.content !== undefined);
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0]?.choices[0]?.delta.content).toBe('hel');
    expect(textChunks[1]?.choices[0]?.delta.content).toBe('lo');
    expect(final.output.content).toBe('hello');
  });

  it('emits reasoning-delta chunks and accumulates thinking_blocks', async () => {
    const { chunks, final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'step one' },
          { type: 'reasoning-end', id: 'r1' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const reasoningChunks = chunks.filter(c => c.choices[0]?.delta.reasoning_content !== undefined);
    expect(reasoningChunks).toHaveLength(1);
    expect(reasoningChunks[0]?.choices[0]?.delta.reasoning_content).toBe('step one');
    expect(final.output.thinking_blocks).toEqual([{ type: 'thinking', thinking: 'step one' }]);
  });

  it('attaches signature from providerMetadata.*.reasoningEncryptedContent on reasoning-end (OpenAI)', async () => {
    const providerMetadata: ProviderMetadata = { openai: { reasoningEncryptedContent: 'enc-sig' } };
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'thought' },
          { type: 'reasoning-end', id: 'r1', providerMetadata },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks?.[0]).toMatchObject({
      type: 'thinking',
      thinking: 'thought',
      signature: 'enc-sig',
    });
  });

  it('attaches signature from providerMetadata.*.signature on reasoning-end (Anthropic)', async () => {
    const providerMetadata: ProviderMetadata = { anthropic: { signature: 'ant-sig' } };
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'thought' },
          { type: 'reasoning-end', id: 'r1', providerMetadata },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks?.[0]).toMatchObject({
      type: 'thinking',
      thinking: 'thought',
      signature: 'ant-sig',
    });
  });

  // OpenAI's real wire shape once summaries are on: one reasoning item arrives as several summary
  // parts, each closed with the item's single token. A block per part would replay that one item
  // once per part, all copies carrying the same token with the summary divided between them.
  it('keeps the summary parts of one OpenAI reasoning item in a single block', async () => {
    const itemId = 'rs_abc';
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: `${itemId}:0`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-delta', id: `${itemId}:0`, text: 'first summary' },
          {
            type: 'reasoning-end',
            id: `${itemId}:0`,
            providerMetadata: { openai: { itemId, reasoningEncryptedContent: 'enc-item' } },
          },
          { type: 'reasoning-start', id: `${itemId}:1`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-delta', id: `${itemId}:1`, text: 'second summary' },
          {
            type: 'reasoning-end',
            id: `${itemId}:1`,
            providerMetadata: { openai: { itemId, reasoningEncryptedContent: 'enc-item' } },
          },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'first summary\n\nsecond summary', signature: 'enc-item' },
    ]);
  });

  // The same grouping has to hold when only the closing part carries the token, which is how the
  // provider behaved before it began repeating it, and all a stream is contractually promised.
  it('signs the whole item when only its closing part carries the token', async () => {
    const itemId = 'rs_abc';
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: `${itemId}:0`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-delta', id: `${itemId}:0`, text: 'first summary' },
          { type: 'reasoning-end', id: `${itemId}:0`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-start', id: `${itemId}:1`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-delta', id: `${itemId}:1`, text: 'second summary' },
          {
            type: 'reasoning-end',
            id: `${itemId}:1`,
            providerMetadata: { openai: { itemId, reasoningEncryptedContent: 'enc-sig' } },
          },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'first summary\n\nsecond summary', signature: 'enc-sig' },
    ]);
  });

  // An item can open a summary part it never writes to, which must not push the reasoning that
  // follows behind a blank line.
  it('does not indent the text of an item whose first part is empty', async () => {
    const itemId = 'rs_abc';
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: `${itemId}:0`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-end', id: `${itemId}:0`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-start', id: `${itemId}:1`, providerMetadata: { openai: { itemId } } },
          { type: 'reasoning-delta', id: `${itemId}:1`, text: 'the only summary' },
          {
            type: 'reasoning-end',
            id: `${itemId}:1`,
            providerMetadata: { openai: { itemId, reasoningEncryptedContent: 'enc-item' } },
          },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'the only summary', signature: 'enc-item' },
    ]);
  });

  it('keeps separate reasoning items in separate blocks, each with its own token', async () => {
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'rs_1:0', providerMetadata: { openai: { itemId: 'rs_1' } } },
          { type: 'reasoning-delta', id: 'rs_1:0', text: 'before the tool call' },
          {
            type: 'reasoning-end',
            id: 'rs_1:0',
            providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' } },
          },
          { type: 'reasoning-start', id: 'rs_2:0', providerMetadata: { openai: { itemId: 'rs_2' } } },
          { type: 'reasoning-delta', id: 'rs_2:0', text: 'after the tool call' },
          {
            type: 'reasoning-end',
            id: 'rs_2:0',
            providerMetadata: { openai: { itemId: 'rs_2', reasoningEncryptedContent: 'enc-2' } },
          },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'before the tool call', signature: 'enc-1' },
      { type: 'thinking', thinking: 'after the tool call', signature: 'enc-2' },
    ]);
  });

  // Anthropic's real wire shape: signature_delta surfaces as a text-less reasoning-delta, not on
  // reasoning-end. Missing it leaves the block unsigned, and Anthropic drops unsigned thinking
  // blocks when they are replayed, silently losing the reasoning chain.
  it('attaches signature from a text-less reasoning-delta (Anthropic signature_delta)', async () => {
    const providerMetadata: ProviderMetadata = { anthropic: { signature: 'ant-delta-sig' } };
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'thought' },
          { type: 'reasoning-delta', id: 'r1', text: '', providerMetadata },
          { type: 'reasoning-end', id: 'r1' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks?.[0]).toMatchObject({
      type: 'thinking',
      thinking: 'thought',
      signature: 'ant-delta-sig',
    });
  });

  it('keeps a reasoning-delta that arrives without a reasoning-start, along with its signature', async () => {
    const providerMetadata: ProviderMetadata = { anthropic: { signature: 'orphan-sig' } };
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-delta', id: 'r1', text: 'unopened thought', providerMetadata },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'unopened thought', signature: 'orphan-sig' },
    ]);
  });

  it('drops a tool-input-delta whose id never opened, rather than crediting tool call 0', async () => {
    const { chunks } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-a', toolName: 'tool_a' },
          { type: 'tool-input-delta', id: 'call-a', delta: '{"city":' },
          { type: 'tool-input-delta', id: 'ghost', delta: '"CORRUPT"' },
          { type: 'tool-input-delta', id: 'call-a', delta: '"Paris"}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const streamedArgs = chunks
      .map(c => c.choices[0]?.delta.tool_calls?.[0]?.function?.arguments)
      .filter(Boolean)
      .join('');
    expect(streamedArgs).toBe('{"city":"Paris"}');
  });

  it('assigns unique ascending indices to interleaved tool-input-* parts', async () => {
    const { chunks } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-a', toolName: 'tool_a' },
          { type: 'tool-input-start', id: 'call-b', toolName: 'tool_b' },
          { type: 'tool-input-delta', id: 'call-a', delta: '{"k"' },
          { type: 'tool-input-delta', id: 'call-b', delta: '{}' },
          { type: 'tool-input-delta', id: 'call-a', delta: ':1}' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const startChunks = chunks.filter(c => c.choices[0]?.delta.tool_calls?.[0]?.id !== undefined);
    expect(startChunks).toHaveLength(2);
    const indices = startChunks.map(c => c.choices[0]?.delta.tool_calls?.[0]?.index);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(1);
  });

  it('accumulates tool_calls arguments in the final message', async () => {
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-1', toolName: 'search' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"q"' },
          { type: 'tool-input-delta', id: 'call-1', delta: ':"hi"}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.tool_calls).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"hi"}' } },
    ]);
    expect(final.finish_reason).toBe('tool_calls');
  });

  it('captures google thoughtSignature from tool-input-start providerMetadata into provider_specific_fields', async () => {
    const providerMetadata: ProviderMetadata = { google: { thoughtSignature: 'google-sig-abc' } };
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-g', toolName: 'search_tool', providerMetadata },
          { type: 'tool-input-delta', id: 'call-g', delta: '{"q":"test"}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.tool_calls?.[0]).toMatchObject({
      id: 'call-g',
      type: 'function',
      function: { name: 'search_tool', arguments: '{"q":"test"}' },
      provider_specific_fields: { thought_signature: 'google-sig-abc' },
    });
  });

  it('omits provider_specific_fields when no thoughtSignature is present on tool-input-start', async () => {
    const { final } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-x', toolName: 'noop' },
          { type: 'tool-input-delta', id: 'call-x', delta: '{}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(final.output.tool_calls?.[0]).not.toHaveProperty('provider_specific_fields');
  });

  it('emits a finish chunk with usage and sets the final message finish_reason', async () => {
    const usage = makeUsage(20, 10);
    usage.raw = { costInUSD: 0.12 };
    const { chunks, final } = await drainStream(
      mapStreamToChunks({ stream: makeStream([makeFinishStep('length', usage)]), chunkMeta: CHUNK_META }),
    );

    const finishChunk = chunks.find(c => c.choices[0]?.finish_reason !== null);
    expect(finishChunk?.choices[0]?.finish_reason).toBe('length');
    expect(finishChunk?.usage).toMatchObject({
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      cost_in_usd: 0.12,
    });
    expect(final.finish_reason).toBe('length');
    expect(final.usage.cost_in_usd).toBe(0.12);
  });

  it('rejects with the provider message on an error part', async () => {
    const cause = new Error('upstream error');
    await expect(
      drainStream(
        mapStreamToChunks({
          stream: makeStream([{ type: 'error', error: cause }]),
          chunkMeta: CHUNK_META,
        }),
      ),
    ).rejects.toMatchObject({ message: 'upstream error', cause });
  });

  it('rejects on an abort part rather than returning the partial message as a clean stop', async () => {
    await expect(
      drainStream(
        mapStreamToChunks({
          stream: makeStream([{ type: 'text-delta', id: 't1', text: 'partial' }, { type: 'abort' }]),
          chunkMeta: CHUNK_META,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with describeStreamError output for an APICallError part', async () => {
    const cause = new APICallError({
      message: 'invalid x-api-key',
      url: 'https://example.com',
      requestBodyValues: {},
      statusCode: 401,
    });
    await expect(
      drainStream(
        mapStreamToChunks({
          stream: makeStream([{ type: 'error', error: cause }]),
          chunkMeta: CHUNK_META,
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Request failed (401): invalid x-api-key',
      cause,
    });
  });

  it('rejects with describeStreamError output for a plain-object error part', async () => {
    await expect(
      drainStream(
        mapStreamToChunks({
          stream: makeStream([{ type: 'error', error: { message: 'The requested model does not exist.' } }]),
          chunkMeta: CHUNK_META,
        }),
      ),
    ).rejects.toMatchObject({
      message: 'The requested model does not exist.',
      cause: { message: 'The requested model does not exist.' },
    });
  });

  it('sets chunk metadata (id, model, object) on emitted chunks', async () => {
    const meta = { id: 'vc-test-001', created: 1000, model: 'my-model' };
    const { chunks } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([{ type: 'text-delta', id: 't1', text: 'x' }, makeFinishStep('stop')]),
        chunkMeta: meta,
      }),
    );
    const chunk = chunks[0];
    expect(chunk?.id).toBe('vc-test-001');
    expect(chunk?.model).toBe('my-model');
    expect(chunk?.object).toBe('chat.completion.chunk');
  });

  it('ignores structural/bookkeeping stream parts without emitting chunks', async () => {
    const { chunks } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'start' },
          { type: 'text-start', id: 't1' },
          { type: 'text-end', id: 't1' },
          { type: 'tool-input-end', id: 'c1' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );
    // Only the finish-step chunk is emitted (no text-delta chunks for structural parts).
    const nonFinishChunks = chunks.filter(c => c.choices[0]?.finish_reason === null);
    expect(nonFinishChunks).toHaveLength(0);
  });
});
