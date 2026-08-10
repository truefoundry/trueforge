import { describe, expect, it } from 'vitest';

import {
  hasReasoningEfforts,
  modelPatchWithReasoningEffort,
  resolveReasoningEffort,
} from '@/atoms/draft/reasoningEffort.js';

describe('hasReasoningEfforts', () => {
  it('is false for nullish or empty', () => {
    expect(hasReasoningEfforts(undefined)).toBe(false);
    expect(hasReasoningEfforts([])).toBe(false);
  });

  it('is true when non-empty', () => {
    expect(hasReasoningEfforts(['low'])).toBe(true);
  });
});

describe('resolveReasoningEffort', () => {
  it('returns undefined when no efforts', () => {
    expect(resolveReasoningEffort(undefined, 'high')).toBeUndefined();
    expect(resolveReasoningEffort([], 'high')).toBeUndefined();
  });

  it('keeps current when still listed', () => {
    expect(resolveReasoningEffort(['low', 'high'], 'high')).toBe('high');
  });

  it('falls back to first when current missing or invalid', () => {
    expect(resolveReasoningEffort(['low', 'high'], undefined)).toBe('low');
    expect(resolveReasoningEffort(['low', 'high'], 'medium')).toBe('low');
  });
});

describe('modelPatchWithReasoningEffort', () => {
  it('sets effort and preserves other params', () => {
    expect(modelPatchWithReasoningEffort('m', { maxTokens: 100, reasoningEffort: 'high' }, ['low', 'high'])).toEqual({
      name: 'm',
      params: { maxTokens: 100, reasoningEffort: 'high' },
    });
  });

  it('falls back to first and clears effort when model has none', () => {
    expect(modelPatchWithReasoningEffort('m', { maxTokens: 100, reasoningEffort: 'high' }, ['low'])).toEqual({
      name: 'm',
      params: { maxTokens: 100, reasoningEffort: 'low' },
    });

    // `undefined` must be present so mergeAgentSpec overwrites a sticky effort.
    expect(modelPatchWithReasoningEffort('m', { maxTokens: 100, reasoningEffort: 'high' }, [])).toEqual({
      name: 'm',
      params: { maxTokens: 100, reasoningEffort: undefined },
    });

    expect(modelPatchWithReasoningEffort('m', { reasoningEffort: 'high' }, undefined)).toEqual({
      name: 'm',
      params: { reasoningEffort: undefined },
    });
  });
});
