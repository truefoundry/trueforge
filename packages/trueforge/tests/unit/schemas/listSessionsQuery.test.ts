import { foldListSessionsMetadataQuery, LIST_SESSIONS_METADATA_FILTER_MAX_KEYS } from '../../../src/schemas/session';

describe('foldListSessionsMetadataQuery', () => {
  it('passes through non-metadata scalars', () => {
    expect(foldListSessionsMetadataQuery({ limit: '10', order: 'asc' })).toEqual({
      limit: '10',
      order: 'asc',
    });
  });

  it('folds metadata[key]=value into a metadata map', () => {
    expect(
      foldListSessionsMetadataQuery({
        limit: '5',
        'metadata[env]': 'prod',
        'metadata[team]': 'platform',
      }),
    ).toEqual({
      limit: '5',
      metadata: { env: 'prod', team: 'platform' },
    });
  });

  it('omits metadata when no bracket params are present', () => {
    expect(foldListSessionsMetadataQuery({ agent_id: 'a1' })).toEqual({ agent_id: 'a1' });
  });

  it('rejects bare metadata (JSON-string form)', () => {
    expect(() => foldListSessionsMetadataQuery({ metadata: '{"env":"prod"}' })).toThrow(
      /bare metadata is not supported/,
    );
  });

  it('rejects nested bracket forms', () => {
    expect(() => foldListSessionsMetadataQuery({ 'metadata[env][eq]': 'prod' })).toThrow(
      /Nested metadata query parameters/,
    );
    expect(() => foldListSessionsMetadataQuery({ 'metadata[env][in]': 'a,b' })).toThrow(
      /Nested metadata query parameters/,
    );
  });

  it('rejects multi-value metadata params', () => {
    expect(() => foldListSessionsMetadataQuery({ 'metadata[env]': ['prod', 'staging'] })).toThrow(/at most once/);
  });

  it('rejects more than the filter key cap', () => {
    const query: Record<string, unknown> = {};
    for (let i = 0; i < LIST_SESSIONS_METADATA_FILTER_MAX_KEYS + 1; i += 1) {
      query[`metadata[k${String(i)}]`] = 'v';
    }
    expect(() => foldListSessionsMetadataQuery(query)).toThrow(
      new RegExp(`at most ${String(LIST_SESSIONS_METADATA_FILTER_MAX_KEYS)}`),
    );
  });

  it('rejects malformed metadata bracket keys', () => {
    expect(() => foldListSessionsMetadataQuery({ 'metadata[]': 'x' })).toThrow(/Invalid metadata/);
  });
});
