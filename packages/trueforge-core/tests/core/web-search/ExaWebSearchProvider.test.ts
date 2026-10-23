import { ssrfFetch } from '../../../src/core/util/ssrfGuard';
import { ExaWebSearchProvider } from '../../../src/core/web-search/ExaWebSearchProvider';
import { WebSearchProviders } from '../../../src/core/web-search/WebSearchProvider';

jest.mock('../../../src/core/util/ssrfGuard', () => ({ ssrfFetch: jest.fn() }));

const ssrfFetchMock = jest.mocked(ssrfFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function requestOf(callIndex: number): { url: string; headers: Record<string, string>; body: unknown } {
  const call = ssrfFetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`expected ssrfFetch call ${String(callIndex)}`);
  }
  const [url, init] = call;
  const headers = new Headers(init?.headers);
  const body: unknown = JSON.parse(String(init?.body));
  return { url: String(url), headers: Object.fromEntries(headers.entries()), body };
}

beforeEach(() => {
  ssrfFetchMock.mockReset();
});

describe('ExaWebSearchProvider', () => {
  const provider = new ExaWebSearchProvider({ apiKey: 'exa-test-key' });

  it('identifies as exa', () => {
    expect(provider.id).toBe(WebSearchProviders.Exa);
  });

  describe('search', () => {
    it('posts each query to /search with the API key and maps results to hits', async () => {
      ssrfFetchMock.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { url: 'https://a.example', title: 'A', publishedDate: '2026-01-02', highlights: ['one', 'two'] },
            { url: 'https://b.example', title: null, highlights: null },
          ],
        }),
      );

      const result = await provider.search({ search_queries: ['exa docs'], objective: 'find the api' });

      expect(result).toEqual({
        hits: [
          { title: 'A', url: 'https://a.example', snippet: 'one\n\ntwo', published_at: '2026-01-02' },
          { title: '', url: 'https://b.example', snippet: '', published_at: null },
        ],
      });
      const request = requestOf(0);
      expect(request.url).toBe('https://api.exa.ai/search');
      expect(request.headers['x-api-key']).toBe('exa-test-key');
      expect(request.body).toMatchObject({
        query: 'exa docs',
        contents: { highlights: { query: 'find the api' } },
      });
    });

    it('sends operator syntax to Exa verbatim without rewriting the query', async () => {
      ssrfFetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
      const query = 'exa api -site:reddit.com site:github.com "exact phrase" -legacy';

      await provider.search({ search_queries: [query], objective: undefined });

      expect(requestOf(0).body).toMatchObject({ query });
      expect(requestOf(0).body).not.toHaveProperty('includeDomains');
      expect(requestOf(0).body).not.toHaveProperty('excludeDomains');
    });

    it('omits the highlights query when there is no objective', async () => {
      ssrfFetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));

      await provider.search({ search_queries: ['q'], objective: undefined });

      expect(requestOf(0).body).toMatchObject({ contents: { highlights: { maxCharacters: 500 } } });
      expect(requestOf(0).body).not.toHaveProperty('contents.highlights.query');
    });

    it('interleaves multiple queries, dedupes URLs, and caps the total', async () => {
      const hit = (name: string) => ({ url: `https://${name}.example`, title: name, highlights: [name] });
      ssrfFetchMock
        .mockResolvedValueOnce(jsonResponse({ results: [hit('a1'), hit('shared'), hit('a3'), hit('a4')] }))
        .mockResolvedValueOnce(jsonResponse({ results: [hit('b1'), hit('shared'), hit('b3'), hit('b4')] }));

      const result = await provider.search({ search_queries: ['first', 'second'], objective: undefined });

      expect(result.hits.map(h => h.title)).toEqual(['a1', 'b1', 'shared', 'a3', 'b3']);
    });

    it('fails clearly on an invalid API key', async () => {
      ssrfFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401));

      await expect(provider.search({ search_queries: ['q'], objective: undefined })).rejects.toThrow(
        /Exa rejected the API key \(401 Unauthorized\)/,
      );
    });

    it('surfaces other upstream failures with the status', async () => {
      ssrfFetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));

      await expect(provider.search({ search_queries: ['q'], objective: undefined })).rejects.toThrow(
        'Exa request failed (429): rate limited',
      );
    });
  });

  describe('fetch', () => {
    it('posts urls to /contents and maps text into pages', async () => {
      ssrfFetchMock.mockResolvedValueOnce(
        jsonResponse({
          results: [{ url: 'https://a.example', title: 'A', text: 'page body' }],
          statuses: [{ id: 'https://a.example', status: 'success' }],
        }),
      );

      const result = await provider.fetch({ urls: ['https://a.example'], objective: undefined });

      expect(result).toEqual({
        pages: [{ url: 'https://a.example', title: 'A', content: 'page body', error: null }],
      });
      const request = requestOf(0);
      expect(request.url).toBe('https://api.exa.ai/contents');
      expect(request.headers['x-api-key']).toBe('exa-test-key');
      expect(request.body).toEqual({ urls: ['https://a.example'], text: true });
    });

    it('reports per-URL errors from statuses without dropping successful pages', async () => {
      ssrfFetchMock.mockResolvedValueOnce(
        jsonResponse({
          results: [{ url: 'https://ok.example', title: 'OK', text: 'fine' }],
          statuses: [
            { id: 'https://ok.example', status: 'success' },
            { id: 'https://gone.example', status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } },
          ],
        }),
      );

      const result = await provider.fetch({
        urls: ['https://ok.example', 'https://gone.example'],
        objective: undefined,
      });

      expect(result.pages).toEqual([
        { url: 'https://gone.example', title: null, content: '', error: 'CRAWL_NOT_FOUND (HTTP 404)' },
        { url: 'https://ok.example', title: 'OK', content: 'fine', error: null },
      ]);
    });

    it('fails clearly on an invalid API key', async () => {
      ssrfFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401));

      await expect(provider.fetch({ urls: ['https://a.example'], objective: undefined })).rejects.toThrow(
        /Exa rejected the API key/,
      );
    });
  });
});
