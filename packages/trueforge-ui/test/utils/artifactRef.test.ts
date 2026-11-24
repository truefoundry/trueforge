import { describe, expect, it } from 'vitest';

import { artifactIdFromRef, artifactRef } from '@/utils/artifactRef.js';

describe('artifactRef', () => {
  it('joins a hyphenated name and the id', () => {
    expect(artifactRef({ name: 'Q4 GTM brief!', id: 'a1' })).toBe('q4-gtm-brief--a1');
  });

  it('falls back to the id when the name has no usable characters', () => {
    expect(artifactRef({ name: '???', id: 'a1' })).toBe('a1');
  });

  it('reads only the id after the separator, ignoring the name', () => {
    expect(artifactIdFromRef('q4-gtm-brief--a1')).toBe('a1');
    expect(artifactIdFromRef('a1')).toBe('a1');
  });

  it('round-trips a name whose slug contains single hyphens', () => {
    const ref = artifactRef({ name: 'Roadmap - v2', id: '01hzx' });
    expect(ref).toBe('roadmap-v2--01hzx');
    expect(artifactIdFromRef(ref)).toBe('01hzx');
  });
});
