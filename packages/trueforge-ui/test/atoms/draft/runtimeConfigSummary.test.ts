import { describe, expect, it } from 'vitest';

import { runtimeConfigSummary, runtimeConfigValueClassName } from '@/atoms/draft/runtimeConfigSummary.js';

describe('runtimeConfigValueClassName', () => {
  it('uses destructive color for off', () => {
    expect(runtimeConfigValueClassName('off')).toContain('text-failure-bg');
  });

  it('uses primary color for on and numeric values', () => {
    expect(runtimeConfigValueClassName('on')).toContain('text-primary-button-bg');
    expect(runtimeConfigValueClassName('105')).toContain('text-primary-button-bg');
  });
});

describe('runtimeConfigSummary', () => {
  it('lists web search even when the host capability is unavailable', () => {
    expect(runtimeConfigSummary({ webSearch: { enabled: true } }).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'on',
    });
  });

  it('falls back to the host capability when the spec says nothing', () => {
    expect(runtimeConfigSummary({}, { webSearchAvailable: true }).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'on',
    });
    expect(runtimeConfigSummary({}).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'off',
    });
  });
});
