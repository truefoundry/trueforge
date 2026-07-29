import { CompletionUsageSchema, GatewayChatCompletionUsageSchema, getEmptyUsage } from '../../src/core/llm/LLMTypes';
import { mergeUsage } from '../../src/core/llm/usage';

describe('completion usage cost', () => {
  it('accepts gateway-computed cost', () => {
    expect(
      GatewayChatCompletionUsageSchema.parse({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        costInUSD: 0.12,
      }).costInUSD,
    ).toBe(0.12);
  });

  it('normalizes and trims gateway usage to the flat harness shape', () => {
    const normalized = mergeUsage(getEmptyUsage(), {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 },
      cache_creation_input_tokens: 2,
      completion_tokens_details: { reasoning_tokens: 3 },
      costInUSD: 0.12,
    });

    expect(normalized).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 4,
      cache_write_tokens: 2,
      cost_in_USD: 0.12,
    });
    expect(CompletionUsageSchema.parse(normalized)).toEqual(normalized);
  });

  it('sums cost across model calls', () => {
    const merged = mergeUsage(
      {
        ...getEmptyUsage(),
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        cost_in_USD: 0.12,
      },
      {
        ...getEmptyUsage(),
        prompt_tokens: 20,
        completion_tokens: 8,
        total_tokens: 28,
        cost_in_USD: 0.23,
      },
    );

    expect(merged).toMatchObject({
      prompt_tokens: 30,
      completion_tokens: 13,
      total_tokens: 43,
    });
    expect(merged.cost_in_USD).toBe(0.12 + 0.23);
  });

  it('retains full precision and never rounds cost to cents', () => {
    // Sub-cent inputs must survive verbatim; any rounding to 2 dp would collapse these to 0.
    const merged = mergeUsage({ ...getEmptyUsage(), cost_in_USD: 0.0001 }, { ...getEmptyUsage(), cost_in_USD: 0.0002 });

    expect(merged.cost_in_USD).toBe(0.0001 + 0.0002);
    expect(merged.cost_in_USD).toBeGreaterThan(0);
  });

  it('treats a missing cost as zero', () => {
    const merged = mergeUsage(getEmptyUsage(), { ...getEmptyUsage(), cost_in_USD: 0.5 });

    expect(merged.cost_in_USD).toBe(0.5);
  });
});

describe('mergeUsage normalized fields', () => {
  it('sums flat cache-read, cache-write, and cost fields', () => {
    const merged = mergeUsage(
      { ...getEmptyUsage(), cache_read_tokens: 9, cache_write_tokens: 2, cost_in_USD: 0.1 },
      { ...getEmptyUsage(), cache_read_tokens: 4, cache_write_tokens: 3, cost_in_USD: 0.2 },
    );
    expect(merged.cache_read_tokens).toBe(13);
    expect(merged.cache_write_tokens).toBe(5);
    expect(merged.cost_in_USD).toBe(0.1 + 0.2);
  });
});
