import { CompletionUsageSchema, getEmptyUsage } from '../../src/core/llm/LLMTypes';
import { mergeUsage } from '../../src/core/llm/usage';

describe('CompletionUsage', () => {
  it('accepts the canonical harness usage shape', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 4,
      cache_write_tokens: 2,
      reasoning_tokens: 3,
      cost_in_usd: 0.12,
    };
    expect(CompletionUsageSchema.parse(usage)).toEqual(usage);
  });
});

describe('mergeUsage', () => {
  it('sums cost across model calls', () => {
    const merged = mergeUsage(
      {
        ...getEmptyUsage(),
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        cost_in_usd: 0.12,
      },
      {
        ...getEmptyUsage(),
        input_tokens: 20,
        output_tokens: 8,
        total_tokens: 28,
        cost_in_usd: 0.23,
      },
    );

    expect(merged).toMatchObject({
      input_tokens: 30,
      output_tokens: 13,
      total_tokens: 43,
    });
    expect(merged.cost_in_usd).toBe(0.12 + 0.23);
  });

  it('retains full precision and never rounds cost to cents', () => {
    // Sub-cent inputs must survive verbatim; any rounding to 2 dp would collapse these to 0.
    const merged = mergeUsage({ ...getEmptyUsage(), cost_in_usd: 0.0001 }, { ...getEmptyUsage(), cost_in_usd: 0.0002 });

    expect(merged.cost_in_usd).toBe(0.0001 + 0.0002);
    expect(merged.cost_in_usd).toBeGreaterThan(0);
  });

  it('treats a missing cost as zero', () => {
    const merged = mergeUsage(getEmptyUsage(), { ...getEmptyUsage(), cost_in_usd: 0.5 });

    expect(merged.cost_in_usd).toBe(0.5);
  });

  it('sums flat cache, reasoning, and cost fields', () => {
    const merged = mergeUsage(
      { ...getEmptyUsage(), cache_read_tokens: 9, cache_write_tokens: 2, reasoning_tokens: 3, cost_in_usd: 0.1 },
      { ...getEmptyUsage(), cache_read_tokens: 4, cache_write_tokens: 3, reasoning_tokens: 5, cost_in_usd: 0.2 },
    );
    expect(merged.cache_read_tokens).toBe(13);
    expect(merged.cache_write_tokens).toBe(5);
    expect(merged.reasoning_tokens).toBe(8);
    expect(merged.cost_in_usd).toBe(0.1 + 0.2);
  });
});
