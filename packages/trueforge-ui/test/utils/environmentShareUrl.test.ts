import { describe, expect, it } from 'vitest';

import {
  clearEnvironmentShareSearch,
  readEnvironmentShareSearch,
  writeEnvironmentShareSearch,
} from '@/utils/environmentShareUrl.js';

describe('environmentShareUrl', () => {
  it('reads envQ and envIsNew', () => {
    expect(readEnvironmentShareSearch('?envQ=python&envIsNew=true')).toEqual({
      q: 'python',
      isNew: true,
    });
    expect(readEnvironmentShareSearch('')).toEqual({ q: null, isNew: false });
  });

  it('writes and clears share keys', () => {
    const params = new URLSearchParams('keep=1');
    writeEnvironmentShareSearch(params, { q: 'node', isNew: true });
    expect(params.get('envQ')).toBe('node');
    expect(params.get('envIsNew')).toBe('true');
    expect(params.get('keep')).toBe('1');
    clearEnvironmentShareSearch(params);
    expect(params.get('envQ')).toBeNull();
    expect(params.get('envIsNew')).toBeNull();
    expect(params.get('keep')).toBe('1');
  });
});
