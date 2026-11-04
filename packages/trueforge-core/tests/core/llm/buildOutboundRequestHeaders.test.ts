import { buildOutboundRequestHeaders } from '../../../src/core/llm/VercelAILLM';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('buildOutboundRequestHeaders', () => {
  it('merges client and per-call headers for non-TrueFoundry providers', () => {
    expect(
      buildOutboundRequestHeaders({
        providerType: 'openai',
        clientHeaders: { Authorization: 'Bearer a', 'X-Custom': '1' },
        options: { headers: { 'X-Custom': '2', 'X-Extra': '3' } },
      }),
    ).toEqual({
      Authorization: 'Bearer a',
      'X-Custom': '2',
      'X-Extra': '3',
    });
  });

  it('ignores metadata for non-TrueFoundry providers', () => {
    expect(
      buildOutboundRequestHeaders({
        providerType: 'openai',
        clientHeaders: {},
        options: { metadata: { 'tfg.compaction': 'true' } },
      }),
    ).toEqual({});
  });

  it('stamps TrueFoundry anthropic-beta and forward-pings', () => {
    expect(
      buildOutboundRequestHeaders({
        providerType: 'truefoundry',
        clientHeaders: { Authorization: 'Bearer a' },
        options: undefined,
      }),
    ).toEqual({
      Authorization: 'Bearer a',
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
      'x-tfy-forward-pings': 'true',
      'x-tfy-new-header': expect.stringMatching(UUID_PATTERN),
    });
  });

  it('stamps a fresh x-tfy-new-header ID on every TrueFoundry call', () => {
    const build = () =>
      buildOutboundRequestHeaders({ providerType: 'truefoundry', clientHeaders: {}, options: undefined });
    const first = build()['x-tfy-new-header'];
    const second = build()['x-tfy-new-header'];
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });

  it('does not stamp x-tfy-new-header for non-TrueFoundry providers', () => {
    const headers = buildOutboundRequestHeaders({ providerType: 'openai', clientHeaders: {}, options: undefined });
    expect(headers).not.toHaveProperty('x-tfy-new-header');
  });

  it('folds per-call metadata into an existing x-tfy-metadata header', () => {
    const headers = buildOutboundRequestHeaders({
      providerType: 'truefoundry',
      clientHeaders: {
        'x-tfy-metadata': JSON.stringify({
          'tfg.session_id': 'sess-1',
          env: 'prod',
        }),
      },
      options: { metadata: { 'tfg.compaction': 'true' } },
    });
    expect(JSON.parse(headers['x-tfy-metadata'] ?? '')).toEqual({
      'tfg.session_id': 'sess-1',
      env: 'prod',
      'tfg.compaction': 'true',
    });
    expect(headers['x-tfy-forward-pings']).toBe('true');
  });

  it('creates x-tfy-metadata when the client had none', () => {
    const headers = buildOutboundRequestHeaders({
      providerType: 'truefoundry',
      clientHeaders: {},
      options: { metadata: { 'tfg.compaction': 'true' } },
    });
    expect(JSON.parse(headers['x-tfy-metadata'] ?? '')).toEqual({ 'tfg.compaction': 'true' });
  });
});
