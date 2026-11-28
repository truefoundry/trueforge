import { describe, expect, it } from 'vitest';

import { formatProviderName, providerKeyUrl } from '@/containers/Onboarding/providerKeyLinks.js';

describe('providerKeyLinks', () => {
  it('links well-known providers to their key page', () => {
    expect(providerKeyUrl('openai')).toBe('https://platform.openai.com/api-keys');
  });

  it('returns undefined for providers without a known key page', () => {
    expect(providerKeyUrl('constructor')).toBeUndefined();
    expect(providerKeyUrl('self-hosted')).toBeUndefined();
  });

  it('capitalizes catalog names', () => {
    expect(formatProviderName('openai')).toBe('Openai');
    expect(formatProviderName('')).toBe('');
  });
});
