import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { harnessFetch, toHarnessUrl } from './harnessFetch';

describe('toHarnessUrl', () => {
  it('maps both session prefixes onto /api/sessions', () => {
    assert.equal(toHarnessUrl('/v1/agents/draft-sessions'), '/api/sessions');
    assert.equal(toHarnessUrl('/v1/agents/sessions'), '/api/sessions');
    assert.equal(toHarnessUrl('/v1/agents/sessions/ses_1/turns'), '/api/sessions/ses_1/turns');
    assert.equal(toHarnessUrl('/v1/agents/draft-sessions?limit=10'), '/api/sessions?limit=10');
  });

  it('preserves the origin of absolute urls', () => {
    assert.equal(
      toHarnessUrl('http://localhost:8790/v1/agents/sessions/ses_1'),
      'http://localhost:8790/api/sessions/ses_1',
    );
  });

  it('leaves other paths untouched', () => {
    assert.equal(toHarnessUrl('/api/models'), '/api/models');
    assert.equal(toHarnessUrl('/api/sessions/ses_1'), '/api/sessions/ses_1');
    // A longer segment only shares the prefix; it is a different route.
    assert.equal(toHarnessUrl('/v1/agents/sessions-archive'), '/v1/agents/sessions-archive');
    // Only the path is matched, so a prefix inside the query means nothing.
    assert.equal(toHarnessUrl('/api/sessions?next=/v1/agents/sessions'), '/api/sessions?next=/v1/agents/sessions');
  });
});

describe('harnessFetch', () => {
  it('rewrites string, URL and Request inputs through the global fetch', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL) => {
      seen.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response('ok'));
    };

    try {
      await harnessFetch('/v1/agents/sessions');
      await harnessFetch(new URL('http://localhost:8790/v1/agents/draft-sessions'));
      await harnessFetch(new Request('http://localhost:8790/v1/agents/sessions/ses_1'));
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.deepEqual(seen, [
      '/api/sessions',
      'http://localhost:8790/api/sessions',
      'http://localhost:8790/api/sessions/ses_1',
    ]);
  });

  it('passes a bodied Request through untouched when the path needs no rewrite', async () => {
    const originalFetch = globalThis.fetch;
    let forwarded: Request | undefined;
    globalThis.fetch = (input: RequestInfo | URL) => {
      if (input instanceof Request) forwarded = input;
      return Promise.resolve(new Response('ok'));
    };

    const request = new Request('http://localhost:8790/api/sessions', { method: 'POST', body: '{"a":1}' });
    try {
      await harnessFetch(request);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(forwarded, request);
    assert.equal(await request.text(), '{"a":1}');
  });
});
