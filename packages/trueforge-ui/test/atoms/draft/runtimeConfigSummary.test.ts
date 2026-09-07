import { describe, expect, it } from 'vitest';

import { runtimeConfigValueClassName } from '@/atoms/draft/runtimeConfigSummary.js';

describe('runtimeConfigValueClassName', () => {
  it('uses destructive color for off', () => {
    expect(runtimeConfigValueClassName('off')).toContain('text-failure-bg');
  });

  it('uses primary color for on and numeric values', () => {
    expect(runtimeConfigValueClassName('on')).toContain('text-primary-button-bg');
    expect(runtimeConfigValueClassName('105')).toContain('text-primary-button-bg');
  });
});
