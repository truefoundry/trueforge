import { describe, expect, it } from 'vitest';

import {
  hasReasoningEfforts,
  modelPatchWithReasoningEffort,
  reasoningEffortSeed,
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

  it('falls back to "high" when current is missing or invalid and "medium" is not offered', () => {
    expect(resolveReasoningEffort(['low', 'high'], undefined)).toBe('high');
    expect(resolveReasoningEffort(['low', 'high'], 'medium')).toBe('high');
  });

  it('defaults to "medium" when the model offers it', () => {
    expect(resolveReasoningEffort(['none', 'low', 'medium', 'high'], undefined)).toBe('medium');
    expect(resolveReasoningEffort(['low', 'medium', 'high'], 'bogus')).toBe('medium');
  });

  it('defaults to "high" before "low", and to "low" when neither "medium" nor "high" is offered', () => {
    expect(resolveReasoningEffort(['none', 'low', 'high'], undefined)).toBe('high');
    expect(resolveReasoningEffort(['none', 'minimal', 'low'], 'bogus')).toBe('low');
  });

  it('defaults to the lowest non-"none" effort when no preferred effort is offered, skipping "none"', () => {
    expect(resolveReasoningEffort(['none', 'minimal', 'xhigh'], undefined)).toBe('minimal');
  });

  it('still honors an explicit "none" selection', () => {
    expect(resolveReasoningEffort(['none', 'low', 'high'], 'none')).toBe('none');
  });

  it('falls back to "none" only when it is the sole effort', () => {
    expect(resolveReasoningEffort(['none'], undefined)).toBe('none');
  });
});

describe('reasoningEffortSeed', () => {
  it('defaults to medium when the catalog or playground fallback offers it', () => {
    expect(reasoningEffortSeed(['none', 'low', 'medium', 'high'])).toBe('medium');
    expect(reasoningEffortSeed(undefined)).toBe('medium');
  });

  it('prefers high over low when medium is absent', () => {
    expect(reasoningEffortSeed(['none', 'low', 'high'])).toBe('high');
  });

  it('uses the lowest non-none effort when no preferred effort is listed', () => {
    expect(reasoningEffortSeed(['none', 'minimal'])).toBe('minimal');
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
