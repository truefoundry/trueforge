import { foldDeepObjectQueryParam, honoQueriesToRecord } from '../../../src/schemas/deepObjectQuery';

describe('honoQueriesToRecord', () => {
  it('unwraps single-value arrays', () => {
    expect(honoQueriesToRecord({ limit: ['10'], 'metadata[env]': ['prod'] })).toEqual({
      limit: '10',
      'metadata[env]': 'prod',
    });
  });

  it('keeps multi-value arrays', () => {
    expect(honoQueriesToRecord({ tag: ['a', 'b'] })).toEqual({ tag: ['a', 'b'] });
  });
});

describe('foldDeepObjectQueryParam', () => {
  it('passes through unrelated scalars', () => {
    expect(foldDeepObjectQueryParam({ query: { limit: '10', order: 'asc' }, name: 'metadata' })).toEqual({
      limit: '10',
      order: 'asc',
    });
  });

  it('folds name[key]=value into a map under name', () => {
    expect(
      foldDeepObjectQueryParam({
        query: {
          limit: '5',
          'metadata[env]': 'prod',
          'metadata[team]': 'platform',
        },
        name: 'metadata',
      }),
    ).toEqual({
      limit: '5',
      metadata: { env: 'prod', team: 'platform' },
    });
  });

  it('omits name when no bracket params are present', () => {
    expect(foldDeepObjectQueryParam({ query: { agent_id: 'a1' }, name: 'metadata' })).toEqual({
      agent_id: 'a1',
    });
  });

  it('rejects bare name (JSON-string form)', () => {
    expect(() => foldDeepObjectQueryParam({ query: { metadata: '{"env":"prod"}' }, name: 'metadata' })).toThrow(
      /bare metadata is not supported/,
    );
  });

  it('rejects nested bracket forms', () => {
    expect(() => foldDeepObjectQueryParam({ query: { 'metadata[env][eq]': 'prod' }, name: 'metadata' })).toThrow(
      /Nested metadata query parameters/,
    );
    expect(() => foldDeepObjectQueryParam({ query: { 'metadata[env][in]': 'a,b' }, name: 'metadata' })).toThrow(
      /Nested metadata query parameters/,
    );
  });

  it('rejects multi-value params', () => {
    expect(() =>
      foldDeepObjectQueryParam({ query: { 'metadata[env]': ['prod', 'staging'] }, name: 'metadata' }),
    ).toThrow(/at most once/);
  });

  it('rejects more than the optional key cap', () => {
    const query: Record<string, unknown> = {};
    for (let i = 0; i < 11; i += 1) {
      query[`labels[k${String(i)}]`] = 'v';
    }
    expect(() => foldDeepObjectQueryParam({ query, name: 'labels', maxKeys: 10 })).toThrow(
      /at most 10 labels filter keys/,
    );
  });

  it('rejects malformed empty bracket keys', () => {
    expect(() => foldDeepObjectQueryParam({ query: { 'metadata[]': 'x' }, name: 'metadata' })).toThrow(
      /Invalid metadata/,
    );
  });
});
