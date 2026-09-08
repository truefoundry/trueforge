import { describe, expect, it } from 'vitest';

import { modelMatchesQuery, normalizeModelSearchText, providerMatchesQuery } from '@/atoms/draft/modelSearch.js';
import type { ModelSelection } from '@/server/types.js';

const model: ModelSelection = {
  id: 'gpt-4o',
  name: 'openai/gpt-4o',
  provider: { name: 'Open_AI' },
  properties: {},
};

describe('model search', () => {
  it('normalizes casing, hyphens, underscores, and whitespace', () => {
    expect(normalizeModelSearchText(' GPT-4_o ')).toBe('gpt4o');
  });

  it('matches normalized model names and ids', () => {
    expect(modelMatchesQuery({ model, needle: normalizeModelSearchText('GPT 4o') })).toBe(true);
    expect(modelMatchesQuery({ model, needle: normalizeModelSearchText('gpt_4o') })).toBe(true);
  });

  it('matches provider names and empty queries', () => {
    expect(providerMatchesQuery({ providerName: model.provider.name, needle: 'openai' })).toBe(true);
    expect(modelMatchesQuery({ model, needle: '' })).toBe(true);
  });
});
