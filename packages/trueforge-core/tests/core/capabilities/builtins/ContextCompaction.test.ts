import {
  DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  resolveCompactionThresholdTokens,
} from '../../../../src/core/capabilities/builtins/ContextCompaction';

describe('resolveCompactionThresholdTokens', () => {
  it('prefers an explicit input-token trigger', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: 80_000,
        modelContextLength: 200_000,
        modelParams: { max_tokens: 150_000 },
      }),
    ).toBe(80_000);
  });

  it('defaults to 80% of the model context length', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_001,
        modelParams: undefined,
      }),
    ).toBe(102_400);
  });

  it.each([
    { modelParams: { max_tokens: 32_768 }, name: 'max_tokens' },
    { modelParams: { max_completion_tokens: 32_768 }, name: 'max_completion_tokens' },
  ])('reserves the configured $name output budget', ({ modelParams }) => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(95_232);
  });

  it('prefers max_completion_tokens over max_tokens', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams: { max_completion_tokens: 32_768, max_tokens: 64_000 },
      }),
    ).toBe(95_232);
  });

  it('keeps the 80% threshold when it already leaves enough output budget', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams: { max_tokens: 16_000 },
      }),
    ).toBe(102_400);
  });

  it.each([
    { modelParams: { max_tokens: 128_000 }, name: 'max_tokens equal to the context length' },
    { modelParams: { max_completion_tokens: 200_000 }, name: 'max_completion_tokens above the context length' },
    { modelParams: { max_tokens: 127_999.5 }, name: 'max_tokens leaving less than one whole input token' },
  ])('falls back to the 80% threshold when $name leaves no input budget', ({ modelParams }) => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(102_400);
  });

  it('falls back to 50K when the model context length is unknown', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: undefined,
        modelParams: { max_tokens: 32_768 },
      }),
    ).toBe(DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS);
  });
});
