/**
 * Conversion of OpenAI response_format → StructuredOutputSpec, and assembly of
 * provider-specific options (reasoning effort, strictJsonSchema) for each provider.
 */
import type {
  StructuredOutputSpec,
  VercelAIProviderConfig,
  VercelAIProviderName,
} from '../../../src/core/llm/VercelAILLM';
import { buildProviderOptions, toReasoningLevel, toStructuredOutputSpec } from '../../../src/core/llm/VercelAILLM';

function makeConfig(
  overrides: Omit<Partial<VercelAIProviderConfig>, 'provider' | 'model'> & {
    provider: VercelAIProviderName;
  },
): VercelAIProviderConfig {
  const { provider, ...rest } = overrides;
  return {
    name: 'test',
    model: { id: 'test-model', name: 'test-model' },
    apiKey: 'sk-test',
    headers: {},
    ...rest,
    provider: { type: provider, name: provider },
  };
}

// ─────────── toStructuredOutputSpec ───────────

describe('toStructuredOutputSpec', () => {
  it('returns text mode when response_format is undefined', () => {
    expect(toStructuredOutputSpec(undefined)).toEqual({ mode: 'text' });
  });

  it('returns text mode for type:text', () => {
    expect(toStructuredOutputSpec({ type: 'text' })).toEqual({ mode: 'text' });
  });

  it('returns json mode for type:json_object', () => {
    expect(toStructuredOutputSpec({ type: 'json_object' })).toEqual({ mode: 'json' });
  });

  it('returns json_schema mode with full spec', () => {
    const result = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: {
        name: 'MySchema',
        description: 'desc',
        schema: { type: 'object', properties: { x: { type: 'string' } } },
        strict: true,
      },
    });
    expect(result).toEqual({
      mode: 'json_schema',
      name: 'MySchema',
      description: 'desc',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
      strict: true,
    });
  });

  it('maps strict: false to false', () => {
    const result = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: { name: 'S', schema: {}, strict: false },
    });
    expect((result as { strict?: boolean | null }).strict).toBe(false);
  });

  it('maps strict: null / omitted to undefined', () => {
    const withNull = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: { name: 'S', schema: {}, strict: null },
    });
    expect((withNull as { strict?: boolean | null }).strict).toBeUndefined();

    const withOmitted = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: { name: 'S', schema: {} },
    });
    expect((withOmitted as { strict?: boolean | null }).strict).toBeUndefined();
  });

  it('falls back to empty object schema when json_schema.schema is absent', () => {
    const result = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: { name: 'S' },
    });
    expect((result as { schema?: unknown }).schema).toEqual({ type: 'object', properties: {} });
  });

  it('omits description when not provided', () => {
    const result = toStructuredOutputSpec({
      type: 'json_schema',
      json_schema: { name: 'S', schema: {} },
    });
    expect((result as { description?: unknown }).description).toBeUndefined();
  });
});

// ─────────── toReasoningLevel ───────────

describe('toReasoningLevel', () => {
  it('passes through every level the SDK union can express', () => {
    const validLevels = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
    for (const level of validLevels) {
      expect(toReasoningLevel(level)).toBe(level);
    }
  });

  it('returns undefined for an absent or unrecognised effort', () => {
    expect(toReasoningLevel(undefined)).toBeUndefined();
    expect(toReasoningLevel('ultra')).toBeUndefined();
    expect(toReasoningLevel('')).toBeUndefined();
  });

  it('maps `max` onto the SDK ceiling, which adapters raise back for models lacking xhigh', () => {
    expect(toReasoningLevel('max')).toBe('xhigh');
  });
});

// ─────────── buildProviderOptions ───────────

describe('buildProviderOptions', () => {
  const textSpec: StructuredOutputSpec = { mode: 'text' };
  const jsonSpec: StructuredOutputSpec = { mode: 'json' };
  const schemaSpecStrict: StructuredOutputSpec = {
    mode: 'json_schema',
    name: 'S',
    description: undefined,
    schema: {},
    strict: true,
  };
  const schemaSpecNoStrict: StructuredOutputSpec = {
    mode: 'json_schema',
    name: 'S',
    description: undefined,
    schema: {},
    strict: undefined,
  };

  describe('openai provider', () => {
    const config = makeConfig({ provider: 'openai' });

    it('always includes store:false and include array', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] });
    });

    // The gpt-5.6 family offers both xhigh and max, so the aliased xhigh reasons a step short.
    it('sends `max` as an effort of its own, since the top-level setting caps at xhigh', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'max',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).toMatchObject({ reasoningEffort: 'max' });
    });

    it('asks for a reasoning summary, without which the model reasons but returns no text', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).toMatchObject({ reasoningSummary: 'auto' });
    });

    it('lets an explicit reasoning_summary replace the default', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: { reasoning_summary: 'detailed' },
      });
      expect(opts['openai']).toMatchObject({ reasoningSummary: 'detailed' });
    });

    it('includes strictJsonSchema:true when spec is json_schema with strict:true', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts['openai']).toMatchObject({ strictJsonSchema: true });
    });

    it('omits strictJsonSchema for non-json_schema modes', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: jsonSpec,
        rawBody: {},
      });
      expect(opts['openai']).not.toHaveProperty('strictJsonSchema');
    });

    it('omits strictJsonSchema when strict is undefined in spec', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecNoStrict,
        rawBody: {},
      });
      expect(opts['openai']).not.toHaveProperty('strictJsonSchema');
    });

    it('forwards service_tier, user, and prompt_cache_key from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: { service_tier: 'auto', user: 'u-123', prompt_cache_key: 'key-abc' },
      });
      expect(opts['openai']).toMatchObject({ serviceTier: 'auto', user: 'u-123', promptCacheKey: 'key-abc' });
    });

    it('omits service_tier/user/prompt_cache_key when absent from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).not.toHaveProperty('serviceTier');
      expect(opts['openai']).not.toHaveProperty('user');
      expect(opts['openai']).not.toHaveProperty('promptCacheKey');
    });
  });

  describe('anthropic provider', () => {
    const config = makeConfig({ provider: 'anthropic' });

    it('leaves thinking to the SDK so per-model shapes stay correct', () => {
      // Pinning `thinking` here would override the SDK's per-model mapping and send
      // `thinking.type: 'enabled'` to Claude 5, which only accepts 'adaptive'.
      for (const reasoningEffort of [undefined, 'high']) {
        const opts = buildProviderOptions({
          config: config,
          reasoningEffort,
          structuredOutputSpec: textSpec,
          rawBody: {},
        });
        expect(opts).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
      }
    });

    it('forwards a caller-supplied thinking and effort, which override the per-model shape', () => {
      // The caller's only route to disabling thinking, a raw effort, or Claude 5's `display`.
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'max' },
      });
      expect(opts['anthropic']).toEqual({
        cacheControl: { type: 'ephemeral' },
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'max',
      });
    });

    it('ignores strictJsonSchema (no anthropic key for structured-output strictness)', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    });

    it('defaults cacheControl to ephemeral when cache_control is omitted', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['anthropic']).toEqual({ cacheControl: { type: 'ephemeral' } });
    });

    it('forwards cache_control and disable_parallel_tool_use from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: { cache_control: { type: 'ephemeral', ttl: '1h' }, disable_parallel_tool_use: true },
      });
      expect(opts['anthropic']).toMatchObject({
        cacheControl: { type: 'ephemeral', ttl: '1h' },
        disableParallelToolUse: true,
      });
    });
  });

  describe('custom provider', () => {
    const config = makeConfig({ provider: 'custom', baseUrl: 'http://localhost/v1' });

    // The compatible adapter reads options from a key matching the name it was built with, so each
    // OpenAI-compatible provider gets its own bucket rather than a shared one.
    it.each(['custom', 'fireworks', 'zai'] as const)('%s: passes strictJsonSchema under its own key', provider => {
      const opts = buildProviderOptions({
        config: makeConfig({ provider, baseUrl: 'http://localhost/v1' }),
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts).toEqual({ [provider]: { strictJsonSchema: true } });
    });

    it.each(['custom', 'fireworks', 'zai', 'together'] as const)(
      '%s: sends `max` verbatim, which these endpoints ignore when it arrives as xhigh',
      provider => {
        const opts = buildProviderOptions({
          config: makeConfig({ provider, baseUrl: 'http://localhost/v1' }),
          reasoningEffort: 'max',
          structuredOutputSpec: textSpec,
          rawBody: {},
        });
        expect(opts).toEqual({ [provider]: { reasoningEffort: 'max' } });
      },
    );

    // camelCase here sent a key no OpenAI-shaped endpoint reads, which is how it went unnoticed.
    it('forwards body fields under their wire names', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {
          service_tier: 'auto',
          user: 'u-1',
          prompt_cache_key: 'k',
          parallel_tool_calls: false,
          thinking: { type: 'enabled' },
          thinking_budget: 512,
          enable_thinking: true,
          reasoning_history: 'off',
        },
      });
      expect(opts['custom']).toEqual({
        service_tier: 'auto',
        user: 'u-1',
        prompt_cache_key: 'k',
        parallel_tool_calls: false,
        thinking: { type: 'enabled' },
        thinking_budget: 512,
        enable_thinking: true,
        reasoning_history: 'off',
      });
    });

    it('omits the custom key when the resulting object would be empty', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });
  });

  describe('moonshot provider', () => {
    const config = makeConfig({ provider: 'moonshot' });

    it('sends `max` as an effort of its own, since the top-level setting caps at xhigh', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'max',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).toEqual({ moonshotai: { reasoningEffort: 'max' } });
    });

    it('leaves every other effort to the top-level setting', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });

    it('forwards thinking and reasoning_history from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: { thinking: { type: 'disabled' }, reasoning_history: 'preserved' },
      });
      expect(opts['moonshotai']).toEqual({ thinking: { type: 'disabled' }, reasoningHistory: 'preserved' });
    });
  });

  describe('alibaba provider', () => {
    const config = makeConfig({ provider: 'alibaba', baseUrl: 'http://localhost/v1' });

    it('forwards thinking overrides and parallel_tool_calls, which the compatible adapter drops', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: { enable_thinking: false, thinking_budget: 512, parallel_tool_calls: false },
      });
      expect(opts['alibaba']).toEqual({ enableThinking: false, thinkingBudget: 512, parallelToolCalls: false });
    });

    it('sends nothing of its own when rawBody carries no overrides', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'high',
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });
  });

  describe('google-gemini provider', () => {
    const config = makeConfig({ provider: 'google-gemini' });

    it('returns empty providerOptions when rawBody carries no google-specific fields', () => {
      expect(
        buildProviderOptions({
          config: config,
          reasoningEffort: undefined,
          structuredOutputSpec: textSpec,
          rawBody: {},
        }),
      ).toEqual({});
      expect(
        buildProviderOptions({
          config: config,
          reasoningEffort: undefined,
          structuredOutputSpec: schemaSpecStrict,
          rawBody: {},
        }),
      ).toEqual({});
    });

    it('requests thought summaries when a reasoning effort is set', () => {
      expect(
        buildProviderOptions({ config, reasoningEffort: 'high', structuredOutputSpec: textSpec, rawBody: {} }),
      ).toEqual({ google: { thinkingConfig: { includeThoughts: true } } });
    });

    it('keeps an explicit thinking_config while still requesting thought summaries', () => {
      expect(
        buildProviderOptions({
          config,
          reasoningEffort: 'high',
          structuredOutputSpec: textSpec,
          rawBody: { thinking_config: { thinkingBudget: 2048 } },
        }),
      ).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } } });
    });

    it('forwards safety_settings, thinking_config, cached_content from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {
          safety_settings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }],
          thinking_config: { thinkingBudget: 1024 },
          cached_content: 'cachedContents/my-cache',
        },
      });
      expect(opts['google']).toMatchObject({
        safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }],
        thinkingConfig: { thinkingBudget: 1024 },
        cachedContent: 'cachedContents/my-cache',
      });
    });
  });

  describe('cross-provider completeness', () => {
    const providers: VercelAIProviderName[] = ['openai', 'anthropic', 'custom', 'google-gemini', 'moonshot', 'alibaba'];

    // Reasoning travels only on the top-level setting. A providerOptions copy would take precedence
    // over it, so any provider growing one here would silently shadow the requested effort. The one
    // exception is `max`, which the top-level setting cannot express.
    it.each(providers)('%s: no providerOptions entry carries the effort', provider => {
      const config = makeConfig({
        provider,
        ...(provider === 'custom' || provider === 'alibaba' ? { baseUrl: 'http://localhost/v1' } : {}),
      });
      const opts = buildProviderOptions({
        config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });

      expect(toReasoningLevel('high')).toBe('high');
      for (const entry of Object.values(opts)) {
        expect(entry === undefined || !('reasoningEffort' in entry)).toBe(true);
      }
    });

    // `max` arrives as `xhigh`, which OpenAI-shaped APIs read as a weaker level or an unknown
    // string they drop without complaint. Adapters taking an effort of their own get the real one;
    // Anthropic and Gemini rely on their adapters, which resolve `xhigh` correctly.
    it.each([
      ['openai', true],
      ['together', true],
      ['moonshot', true],
      ['anthropic', false],
      ['google-gemini', false],
      ['alibaba', false],
    ] as const)('%s: carries max as its own effort = %s', (provider, carries) => {
      const opts = buildProviderOptions({
        config: makeConfig({ provider, baseUrl: 'http://localhost/v1' }),
        reasoningEffort: 'max',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      const sent = Object.values(opts).some(entry => entry?.['reasoningEffort'] === 'max');
      expect(sent).toBe(carries);
    });
  });
});
