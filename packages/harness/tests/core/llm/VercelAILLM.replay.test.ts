/**
 * End-to-end replay forwarding: stream accumulation → message replay.
 *
 * Each test pipes `mapStreamToChunks` output into `toAssistantModelMessage` and asserts that the
 * provider-specific replay token (reasoning signature / tool thoughtSignature) survives intact.
 *
 * These tests exist because the two layers were previously tested in isolation:
 * - VercelAILLM.stream.test.ts verified chunk emission but not provider_specific_fields on tool_calls
 * - VercelAILLM.messages.test.ts verified replay with hand-crafted inputs that bypassed accumulation
 *
 * A bug in either boundary would not be caught by unit tests alone; these cross-layer tests close
 * that gap for every provider that has a replay token.
 */
import type { LanguageModelUsage, ProviderMetadata, StepResultPerformance, TextStreamPart, ToolSet } from 'ai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import {
  mapStreamToChunks,
  toAssistantModelMessage,
  type VercelAIProviderName,
} from '../../../src/core/llm/VercelAILLM';

// ─────────── Shared helpers ───────────

function makeUsage(): LanguageModelUsage {
  return {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined, noCacheTokens: undefined },
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
  };
}

function makeFinishStep(finishReason: 'stop' | 'tool-calls'): TextStreamPart<ToolSet> {
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
    usage: makeUsage(),
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
): Promise<RawAssistantMessageWithUsage> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

const CHUNK_META = { id: 'test-id', created: 0, model: 'test-model' };

// ─────────── Tool thoughtSignature round-trip (Gemini) ───────────

describe('Gemini tool thoughtSignature replay round-trip', () => {
  it('carries thoughtSignature from stream through provider_specific_fields to replay providerOptions', async () => {
    const toolMetadata: ProviderMetadata = { google: { thoughtSignature: 'gemini-sig-xyz' } };

    const { output } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-g1', toolName: 'search', providerMetadata: toolMetadata },
          { type: 'tool-input-delta', id: 'call-g1', delta: '{"q":"hello"}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    // The stream output must carry thought_signature so the next turn can replay it.
    expect(output.tool_calls?.[0]).toMatchObject({
      provider_specific_fields: { thought_signature: 'gemini-sig-xyz' },
    });

    // Simulate how AgentThread reconstructs the assistant message for the next-turn request.
    const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      ...(output.tool_calls !== undefined ? { tool_calls: output.tool_calls } : {}),
    };
    const replayMsg = toAssistantModelMessage({
      msg: assistantMsg,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    const toolCallPart = (replayMsg.content as Array<{ type: string; providerOptions?: unknown }>).find(
      p => p.type === 'tool-call',
    );
    expect(toolCallPart?.providerOptions).toEqual({ google: { thoughtSignature: 'gemini-sig-xyz' } });
  });

  it('produces no providerOptions on replayed tool-call when no thoughtSignature was in the stream', async () => {
    const { output } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'tool-input-start', id: 'call-plain', toolName: 'noop' },
          { type: 'tool-input-delta', id: 'call-plain', delta: '{}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(output.tool_calls?.[0]).not.toHaveProperty('provider_specific_fields');

    const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      ...(output.tool_calls !== undefined ? { tool_calls: output.tool_calls } : {}),
    };
    const replayMsg = toAssistantModelMessage({
      msg: assistantMsg,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    const toolCallPart = (replayMsg.content as Array<{ type: string }>).find(p => p.type === 'tool-call');
    expect(toolCallPart).not.toHaveProperty('providerOptions');
  });
});

// ─────────── Reasoning signature round-trips ───────────

/**
 * `metadataKey`/`signatureField` are where the response carries the token; `expectedProviderOptions`
 * is what replay must attach to the next request. The keys differ per provider.
 */
type ReasoningRoundTripCase = {
  provider: VercelAIProviderName;
  metadataKey: string;
  signatureField: string;
  signatureValue: string;
  /** `undefined` for providers whose adapter has nowhere to put the token. */
  expectedProviderOptions: Record<string, unknown> | undefined;
};

const REASONING_CASES: ReasoningRoundTripCase[] = [
  {
    provider: 'openai',
    metadataKey: 'openai',
    signatureField: 'reasoningEncryptedContent',
    signatureValue: 'enc-content-openai',
    expectedProviderOptions: { openai: { reasoningEncryptedContent: 'enc-content-openai' } },
  },
  {
    provider: 'anthropic',
    metadataKey: 'anthropic',
    signatureField: 'signature',
    signatureValue: 'ant-sig-value',
    expectedProviderOptions: { anthropic: { signature: 'ant-sig-value' } },
  },
  {
    provider: 'custom',
    // Synthetic namespace: real OpenAI-compatible endpoints send unsigned `reasoning_content` text.
    metadataKey: 'custom',
    signatureField: 'reasoningEncryptedContent',
    signatureValue: 'enc-content-custom',
    expectedProviderOptions: undefined,
  },
];

describe.each(REASONING_CASES)(
  'reasoning signature round-trip ($provider)',
  ({ provider, metadataKey, signatureField, signatureValue, expectedProviderOptions }) => {
    it('carries reasoning signature from stream through thinking_blocks to replay providerOptions', async () => {
      const reasoningMetadata: ProviderMetadata = { [metadataKey]: { [signatureField]: signatureValue } };

      const { output } = await drainStream(
        mapStreamToChunks({
          stream: makeStream([
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', text: 'some thought' },
            { type: 'reasoning-end', id: 'r1', providerMetadata: reasoningMetadata },
            makeFinishStep('stop'),
          ]),
          chunkMeta: CHUNK_META,
        }),
      );

      // The signature must survive into thinking_blocks so the next turn can replay it.
      expect(output.thinking_blocks?.[0]).toMatchObject({
        type: 'thinking',
        thinking: 'some thought',
        signature: signatureValue,
      });

      // Simulate AgentThread reconstructing the assistant message for the next-turn request.
      const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
        role: 'assistant',
        content: null,
      };
      Reflect.set(assistantMsg, 'thinking_blocks', output.thinking_blocks);
      Reflect.set(assistantMsg, 'source', `${provider}/${provider}/test`);

      const replayMsg = toAssistantModelMessage({ msg: assistantMsg, provider, providerName: provider });
      const reasoningPart = (replayMsg.content as Array<{ type: string; providerOptions?: unknown }>).find(
        p => p.type === 'reasoning',
      );
      expect(reasoningPart?.providerOptions).toEqual(expectedProviderOptions);
    });
  },
);

describe('anthropic reasoning replay, on the shape Anthropic actually sends', () => {
  // Anthropic delivers its signature on a text-less reasoning-delta, never on reasoning-end, and a
  // tool turn replays thinking and the tool call together with thinking first.
  it('replays a delta-delivered signature, with thinking ahead of the tool call', async () => {
    const { output } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'need the weather' },
          { type: 'reasoning-delta', id: 'r1', text: '', providerMetadata: { anthropic: { signature: 'ant-delta' } } },
          { type: 'reasoning-end', id: 'r1' },
          { type: 'tool-input-start', id: 'call-a1', toolName: 'get_weather' },
          { type: 'tool-input-delta', id: 'call-a1', delta: '{"city":"Paris"}' },
          makeFinishStep('tool-calls'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      ...(output.tool_calls !== undefined ? { tool_calls: output.tool_calls } : {}),
    };
    Reflect.set(assistantMsg, 'thinking_blocks', output.thinking_blocks);
    Reflect.set(assistantMsg, 'source', 'anthropic/anthropic/test');
    const parts = toAssistantModelMessage({ msg: assistantMsg, provider: 'anthropic', providerName: 'anthropic' })
      .content as Array<{
      type: string;
      providerOptions?: unknown;
    }>;

    expect(parts.map(p => p.type)).toEqual(['reasoning', 'tool-call']);
    expect(parts[0]?.providerOptions).toEqual({ anthropic: { signature: 'ant-delta' } });
  });

  it('does not attach an Anthropic signature when replaying to OpenAI', async () => {
    const { output } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'thought' },
          { type: 'reasoning-delta', id: 'r1', text: '', providerMetadata: { anthropic: { signature: 'ant-sig' } } },
          { type: 'reasoning-end', id: 'r1' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(assistantMsg, 'thinking_blocks', output.thinking_blocks);
    Reflect.set(assistantMsg, 'source', 'anthropic/anthropic/opus');

    const reasoningPart = (
      toAssistantModelMessage({ msg: assistantMsg, provider: 'openai', providerName: 'openai' }).content as Array<{
        type: string;
        text?: string;
        providerOptions?: unknown;
      }>
    ).find(p => p.type === 'reasoning');

    expect(reasoningPart?.text).toBe('thought');
    expect(reasoningPart).not.toHaveProperty('providerOptions');
  });
});

describe('google-gemini reasoning replay round-trip', () => {
  it('emits a reasoning part with no providerOptions (signature is per-tool-call for Gemini)', async () => {
    // Gemini does not attach a standalone reasoning block signature; thoughtSignature is per
    // tool-call (tested in the Gemini tool round-trip suite above). The reasoning block is still
    // accumulated but carries no providerOptions on replay — @ai-sdk/google ignores it.
    const { output } = await drainStream(
      mapStreamToChunks({
        stream: makeStream([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'gemini thought' },
          { type: 'reasoning-end', id: 'r1' },
          makeFinishStep('stop'),
        ]),
        chunkMeta: CHUNK_META,
      }),
    );

    expect(output.thinking_blocks?.[0]).toMatchObject({ type: 'thinking', thinking: 'gemini thought' });
    expect(output.thinking_blocks?.[0]).not.toHaveProperty('signature');

    const assistantMsg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(assistantMsg, 'thinking_blocks', output.thinking_blocks);

    const replayMsg = toAssistantModelMessage({
      msg: assistantMsg,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    const reasoningPart = (replayMsg.content as Array<{ type: string }>).find(p => p.type === 'reasoning');
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart).not.toHaveProperty('providerOptions');
  });
});
