import { CompletionUsageSchema, getEmptyUsage } from '../../src/core/llm/LLMTypes';
import { mergeUsage } from '../../src/core/llm/usage';
import {
  addAgentThreadMetrics,
  createEmptyAgentThreadMetrics,
  updateMetricsFromUsage,
} from '../../src/core/runtime/metrics';

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

  it('requires input, output, and total token counts', () => {
    expect(CompletionUsageSchema.safeParse({}).success).toBe(false);
  });

  it('uses zero for required token counts in empty usage', () => {
    expect(getEmptyUsage()).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    });
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

  it('preserves a missing cost as absent until a call reports one', () => {
    const merged = mergeUsage(getEmptyUsage(), { ...getEmptyUsage(), cost_in_usd: 0.5 });

    expect(merged.cost_in_usd).toBe(0.5);
  });

  it('keeps optional fields undefined when neither side reports them', () => {
    const merged = mergeUsage(getEmptyUsage(), getEmptyUsage());

    expect(merged.cache_read_tokens).toBeUndefined();
    expect(merged.cache_write_tokens).toBeUndefined();
    expect(merged.reasoning_tokens).toBeUndefined();
    expect(merged.cost_in_usd).toBeUndefined();
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

describe('AgentThreadMetrics', () => {
  it('initializes required token totals to zero and leaves optional totals undefined', () => {
    const target = createEmptyAgentThreadMetrics();
    addAgentThreadMetrics(target, createEmptyAgentThreadMetrics());

    expect(target.total_input_tokens).toBe(0);
    expect(target.total_output_tokens).toBe(0);
    expect(target.total_tokens).toBe(0);
    expect(target.total_cache_read_tokens).toBeUndefined();
    expect(target.total_cost_in_usd).toBeUndefined();
  });

  it('materializes required token aggregates after folding usage', () => {
    const target = createEmptyAgentThreadMetrics();

    updateMetricsFromUsage(target, getEmptyUsage());

    expect(target.total_input_tokens).toBe(0);
    expect(target.total_output_tokens).toBe(0);
    expect(target.total_tokens).toBe(0);
    expect(target.total_cache_read_tokens).toBeUndefined();
    expect(target.total_cache_write_tokens).toBeUndefined();
    expect(target.total_reasoning_tokens).toBeUndefined();
    expect(target.total_cost_in_usd).toBeUndefined();
  });
});
