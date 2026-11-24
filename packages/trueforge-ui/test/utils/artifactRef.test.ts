import { describe, expect, it } from 'vitest';

import { artifactIdFromRef, artifactRef } from '@/utils/artifactRef.js';

describe('artifactRef', () => {
  it('joins a hyphenated title and the id', () => {
    expect(artifactRef({ title: 'Q4 GTM brief!', id: 'a1' })).toBe('q4-gtm-brief-a1');
  });

  it('falls back to the id when the title has no usable characters', () => {
    expect(artifactRef({ title: '???', id: 'a1' })).toBe('a1');
  });

  it('reads the id back from the last segment', () => {
    expect(artifactIdFromRef('q4-gtm-brief-a1')).toBe('a1');
    expect(artifactIdFromRef('a1')).toBe('a1');
  });
});
