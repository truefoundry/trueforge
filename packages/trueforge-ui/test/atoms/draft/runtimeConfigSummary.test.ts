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
  it('omits web search when the host capability is unavailable', () => {
    expect(runtimeConfigSummary({ webSearch: { enabled: false } }).map(entry => entry.label)).not.toContain(
      'web search',
    );
  });

  it('includes web search when the host capability is available', () => {
    expect(
      runtimeConfigSummary({ webSearch: { enabled: false } }, { webSearchAvailable: true }).find(
        entry => entry.label === 'web search',
      ),
    ).toEqual({ label: 'web search', value: 'off' });
  });
});
