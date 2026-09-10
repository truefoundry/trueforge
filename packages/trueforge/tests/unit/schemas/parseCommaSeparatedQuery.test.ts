import { parseCommaSeparatedQuery } from '../../../src/schemas/common';

describe('parseCommaSeparatedQuery', () => {
  it('returns undefined when absent or non-string', () => {
    expect(parseCommaSeparatedQuery(undefined)).toBeUndefined();
    expect(parseCommaSeparatedQuery(['a', 'b'])).toBeUndefined();
  });

  it('returns an empty array when the string has no non-empty segments', () => {
    expect(parseCommaSeparatedQuery('')).toEqual([]);
    expect(parseCommaSeparatedQuery('   ')).toEqual([]);
    expect(parseCommaSeparatedQuery(',,,')).toEqual([]);
    expect(parseCommaSeparatedQuery(' , , ')).toEqual([]);
  });

  it('splits on commas, trims, and drops empty segments', () => {
    expect(parseCommaSeparatedQuery('reporter,,reporter-two')).toEqual(['reporter', 'reporter-two']);
    expect(parseCommaSeparatedQuery(' a , b ')).toEqual(['a', 'b']);
  });
});
