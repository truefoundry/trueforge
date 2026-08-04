/**
 * Conversion of OpenAI response_format → StructuredOutputSpec, and assembly of
 * provider-specific options (reasoning effort, strictJsonSchema) for each provider.
 */
import type { StructuredOutputSpec, VercelAIProviderConfig } from '../../../src/core/llm/VercelAILLM';
import { buildProviderOptions, toReasoningLevel, toStructuredOutputSpec } from '../../../src/core/llm/VercelAILLM';

function makeConfig(
  overrides: Partial<VercelAIProviderConfig> & { provider: VercelAIProviderConfig['provider'] },
): VercelAIProviderConfig {
  return { name: 'test', apiKey: 'sk-test', headers: {}, ...overrides };
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
  it('returns undefined for non-google-gemini providers regardless of effort', () => {
    expect(toReasoningLevel({ provider: 'openai', reasoningEffort: 'high' })).toBeUndefined();
    expect(toReasoningLevel({ provider: 'anthropic', reasoningEffort: 'medium' })).toBeUndefined();
    expect(toReasoningLevel({ provider: 'custom', reasoningEffort: 'low' })).toBeUndefined();
  });

  it('returns undefined when reasoningEffort is undefined', () => {
    expect(toReasoningLevel({ provider: 'google-gemini', reasoningEffort: undefined })).toBeUndefined();
  });

  it('returns undefined when reasoningEffort is not a valid ReasoningLevel', () => {
    expect(toReasoningLevel({ provider: 'google-gemini', reasoningEffort: 'ultra' })).toBeUndefined();
    expect(toReasoningLevel({ provider: 'google-gemini', reasoningEffort: '' })).toBeUndefined();
  });

  it('returns the level for all valid ReasoningLevel values on google-gemini', () => {
    const validLevels = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
    for (const level of validLevels) {
      expect(toReasoningLevel({ provider: 'google-gemini', reasoningEffort: level })).toBe(level);
    }
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

    it('includes reasoningEffort when present', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: 'high',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).toMatchObject({ reasoningEffort: 'high' });
    });

    it('omits reasoningEffort key when undefined', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['openai']).not.toHaveProperty('reasoningEffort');
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

    it('returns empty options when reasoningEffort is absent', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });

    it('maps low → 1024, medium → 8192, high → 32768', () => {
      expect(
        buildProviderOptions({ config: config, reasoningEffort: 'low', structuredOutputSpec: textSpec, rawBody: {} })[
          'anthropic'
        ],
      ).toEqual({ thinking: { type: 'enabled', budgetTokens: 1024 } });
      expect(
        buildProviderOptions({
          config: config,
          reasoningEffort: 'medium',
          structuredOutputSpec: textSpec,
          rawBody: {},
        })['anthropic'],
      ).toEqual({ thinking: { type: 'enabled', budgetTokens: 8192 } });
      expect(
        buildProviderOptions({ config: config, reasoningEffort: 'high', structuredOutputSpec: textSpec, rawBody: {} })[
          'anthropic'
        ],
      ).toEqual({ thinking: { type: 'enabled', budgetTokens: 32768 } });
    });

    it('falls back to 8192 for an unrecognised effort level', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: 'ultra',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['anthropic']).toEqual({ thinking: { type: 'enabled', budgetTokens: 8192 } });
    });

    it('ignores strictJsonSchema (no anthropic key for structured-output strictness)', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });

    it('forwards cache_control and disable_parallel_tool_use from rawBody', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: { cache_control: { type: 'ephemeral' }, disable_parallel_tool_use: true },
      });
      expect(opts['anthropic']).toMatchObject({
        cacheControl: { type: 'ephemeral' },
        disableParallelToolUse: true,
      });
    });

    it('omits anthropic key when rawBody fields are absent and no reasoningEffort', () => {
      const opts = buildProviderOptions({
        config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).not.toHaveProperty('anthropic');
    });
  });

  describe('custom provider', () => {
    const config = makeConfig({ provider: 'custom', base_url: 'http://localhost/v1' });

    it('returns empty options when both reasoningEffort and strictJsonSchema are absent', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).toEqual({});
    });

    it('passes reasoningEffort through', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: 'medium',
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts['custom']).toMatchObject({ reasoningEffort: 'medium' });
    });

    it('passes strictJsonSchema for json_schema mode', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts['custom']).toMatchObject({ strictJsonSchema: true });
    });

    it('includes both when both are present', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: 'low',
        structuredOutputSpec: schemaSpecStrict,
        rawBody: {},
      });
      expect(opts['custom']).toEqual({ reasoningEffort: 'low', strictJsonSchema: true });
    });

    it('omits the custom key when the resulting object would be empty', () => {
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: undefined,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      expect(opts).not.toHaveProperty('custom');
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
        buildProviderOptions({ config: config, reasoningEffort: 'high', structuredOutputSpec: textSpec, rawBody: {} }),
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

  describe('cross-provider completeness: every provider must surface reasoningEffort somewhere', () => {
    const providers: VercelAIProviderConfig['provider'][] = ['openai', 'anthropic', 'custom', 'google-gemini'];
    const effort = 'high';

    it.each(providers)('%s: reasoningEffort reaches providerOptions or toReasoningLevel', provider => {
      const config = makeConfig({
        provider,
        ...(provider === 'custom' ? { base_url: 'http://localhost/v1' } : {}),
      });
      const opts = buildProviderOptions({
        config: config,
        reasoningEffort: effort,
        structuredOutputSpec: textSpec,
        rawBody: {},
      });
      const reasoningLevel = toReasoningLevel({ provider: provider, reasoningEffort: effort });

      const inProviderOptions =
        (opts['openai'] !== undefined && 'reasoningEffort' in opts['openai']) ||
        opts['anthropic'] !== undefined ||
        (opts['custom'] !== undefined && 'reasoningEffort' in opts['custom']);

      expect(inProviderOptions || reasoningLevel !== undefined).toBe(true);
    });
  });
});
