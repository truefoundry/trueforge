/**
 * LanguageModel construction and streamText call-args assembly:
 * buildLanguageModel (per-provider construction + capability flags),
 * resolveMaxOutputTokens, and buildStreamTextArgs (key presence under
 * exactOptionalPropertyTypes).
 */
import type { VercelAIProviderConfig, VercelAIProviderName } from '../../../src/core/llm/VercelAILLM';
import {
  buildLanguageModel,
  buildStreamTextArgs,
  convertTools,
  resolveMaxOutputTokens,
} from '../../../src/core/llm/VercelAILLM';

function makeConfig(
  overrides: Omit<Partial<VercelAIProviderConfig>, 'provider' | 'model'> & {
    provider: VercelAIProviderName;
    model?: VercelAIProviderConfig['model'];
  },
): VercelAIProviderConfig {
  const { provider, model, ...rest } = overrides;
  return {
    name: 'test',
    model: model ?? { id: 'test-model', name: 'test-model' },
    apiKey: 'sk-test',
    headers: {},
    ...rest,
    provider: { type: provider, name: provider },
  };
}

// ─────────── buildLanguageModel ───────────

describe('buildLanguageModel', () => {
  it('builds the providers whose adapter carries its own endpoint', () => {
    for (const provider of ['openai', 'anthropic', 'google-gemini', 'moonshot'] as const) {
      expect(buildLanguageModel(makeConfig({ provider }))).toBeDefined();
    }
  });

  // The compatible providers take their endpoint from the caller, which the server resolves from
  // its own defaults. Throwing here beats letting the adapter build a request against no host.
  it('demands a baseUrl from every compatible provider', () => {
    for (const provider of ['fireworks', 'zai', 'custom', 'truefoundry', 'together'] as const) {
      expect(() => buildLanguageModel(makeConfig({ provider }))).toThrow('baseUrl');
      const model: unknown = buildLanguageModel(makeConfig({ provider, baseUrl: 'http://localhost:11434/v1' }));
      if (typeof model !== 'object' || model === null) throw new Error('Expected model to be an object');
      expect(Reflect.get(model, 'supportsStructuredOutputs')).toBe(true);
    }
  });

  // Alibaba endpoints are per-workspace, so falling back to the package default would quietly
  // address someone else's tenant.
  it('demands a baseUrl from alibaba even though its adapter ships a default', () => {
    expect(() => buildLanguageModel(makeConfig({ provider: 'alibaba' }))).toThrow('baseUrl');
    expect(buildLanguageModel(makeConfig({ provider: 'alibaba', baseUrl: 'http://localhost/v1' }))).toBeDefined();
  });

  it('throws for unknown provider string (exhaustive default branch)', () => {
    const badConfig = JSON.parse(
      '{"provider":{"type":"unknown-provider","name":"x"},"name":"x","model":{"id":"m","name":"m"},"apiKey":"k","headers":{}}',
    );
    expect(() => buildLanguageModel(badConfig)).toThrow('Unknown provider');
  });

  // Display `name` is not a model id; only `model.id` is sent to the adapter.
  it('sends model.id, never display name', () => {
    const model: unknown = buildLanguageModel(
      makeConfig({
        provider: 'anthropic',
        name: 'anthropic/alias',
        model: { id: 'claude-sonnet-5', name: 'alias' },
      }),
    );
    if (typeof model !== 'object' || model === null) throw new Error('Expected model to be an object');
    expect(Reflect.get(model, 'modelId')).toBe('claude-sonnet-5');
  });
});

// ─────────── resolveMaxOutputTokens ───────────

describe('resolveMaxOutputTokens', () => {
  it('returns max_completion_tokens when set', () => {
    expect(resolveMaxOutputTokens({ max_completion_tokens: 512 })).toBe(512);
  });

  it('falls back to max_tokens when max_completion_tokens is absent', () => {
    const body = JSON.parse('{"max_tokens":256}');
    expect(resolveMaxOutputTokens(body)).toBe(256);
  });

  it('prefers max_completion_tokens over max_tokens', () => {
    const body = JSON.parse('{"max_completion_tokens":512,"max_tokens":256}');
    expect(resolveMaxOutputTokens(body)).toBe(512);
  });

  it('returns undefined when neither is set', () => {
    expect(resolveMaxOutputTokens({})).toBeUndefined();
  });

  it('returns undefined for non-numeric values', () => {
    const body = JSON.parse('{"max_completion_tokens":"not-a-number"}');
    expect(resolveMaxOutputTokens(body)).toBeUndefined();
  });
});

// ─────────── buildStreamTextArgs ───────────

describe('buildStreamTextArgs', () => {
  const model = buildLanguageModel(makeConfig({ provider: 'anthropic' }));
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('includes all provided optional fields as present keys', () => {
    const tools = convertTools([{ type: 'function', function: { name: 'search', description: 'Search' } }]);
    const result = buildStreamTextArgs({
      model,
      instructions: 'You are helpful.',
      messages,
      tools,
      reasoning: 'high',
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } } },
      maxOutputTokens: 1024,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      stopSequences: ['STOP'],
      seed: 42,
      abortSignal: new AbortController().signal,
    });

    expect('instructions' in result).toBe(true);
    expect('tools' in result).toBe(true);
    expect('reasoning' in result).toBe(true);
    expect('maxOutputTokens' in result).toBe(true);
    expect('temperature' in result).toBe(true);
    expect('topP' in result).toBe(true);
    expect('topK' in result).toBe(true);
    expect('presencePenalty' in result).toBe(true);
    expect('frequencyPenalty' in result).toBe(true);
    expect('stopSequences' in result).toBe(true);
    expect('seed' in result).toBe(true);
    expect('providerOptions' in result).toBe(true);
    expect('abortSignal' in result).toBe(true);
    expect(result.maxRetries).toBe(0);
  });

  it('omits optional keys (not just undefined-valued) when input is absent', () => {
    const result = buildStreamTextArgs({
      model,
      instructions: undefined,
      messages,
      tools: undefined,
      reasoning: undefined,
      providerOptions: {},
      maxOutputTokens: undefined,
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      presencePenalty: undefined,
      frequencyPenalty: undefined,
      stopSequences: undefined,
      seed: undefined,
      abortSignal: undefined,
    });

    expect('instructions' in result).toBe(false);
    expect('tools' in result).toBe(false);
    expect('reasoning' in result).toBe(false);
    expect('maxOutputTokens' in result).toBe(false);
    expect('temperature' in result).toBe(false);
    expect('topP' in result).toBe(false);
    expect('topK' in result).toBe(false);
    expect('presencePenalty' in result).toBe(false);
    expect('frequencyPenalty' in result).toBe(false);
    expect('stopSequences' in result).toBe(false);
    expect('seed' in result).toBe(false);
    expect('providerOptions' in result).toBe(false);
    expect('abortSignal' in result).toBe(false);
  });

  it('omits providerOptions when the object is empty', () => {
    const result = buildStreamTextArgs({
      model,
      instructions: undefined,
      messages,
      tools: undefined,
      reasoning: undefined,
      providerOptions: {},
      maxOutputTokens: undefined,
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      presencePenalty: undefined,
      frequencyPenalty: undefined,
      stopSequences: undefined,
      seed: undefined,
      abortSignal: undefined,
    });
    expect('providerOptions' in result).toBe(false);
  });

  it('omits temperature/topP/topK/presencePenalty/frequencyPenalty/stopSequences/seed when null', () => {
    const result = buildStreamTextArgs({
      model,
      instructions: undefined,
      messages,
      tools: undefined,
      reasoning: undefined,
      providerOptions: {},
      maxOutputTokens: undefined,
      temperature: null,
      topP: null,
      topK: null,
      presencePenalty: null,
      frequencyPenalty: null,
      stopSequences: null,
      seed: null,
      abortSignal: undefined,
    });
    expect('temperature' in result).toBe(false);
    expect('topP' in result).toBe(false);
    expect('topK' in result).toBe(false);
    expect('presencePenalty' in result).toBe(false);
    expect('frequencyPenalty' in result).toBe(false);
    expect('stopSequences' in result).toBe(false);
    expect('seed' in result).toBe(false);
  });
});
