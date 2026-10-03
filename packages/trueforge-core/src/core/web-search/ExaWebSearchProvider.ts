import { z } from 'zod';
import { ssrfFetch } from '../util/ssrfGuard';
import {
  WebSearchProviders,
  type IWebSearchProvider,
  type WebFetchPage,
  type WebFetchPages,
  type WebSearchHit,
  type WebSearchHits,
} from './WebSearchProvider';

const EXA_API_BASE_URL = 'https://api.exa.ai';

/** Keep search payloads under the large-tool-response individual threshold (~6k tokens). */
const EXA_SEARCH_MAX_RESULTS = 5;
const EXA_SEARCH_MAX_CHARS_PER_RESULT = 500;
const EXA_ERROR_BODY_MAX_CHARS = 300;

const ExaSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      publishedDate: z.string().nullish(),
      highlights: z.array(z.string()).nullish(),
    }),
  ),
});

const ExaContentsResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      text: z.string().nullish(),
    }),
  ),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        error: z.object({ tag: z.string().nullish(), httpStatusCode: z.number().nullish() }).nullish(),
      }),
    )
    .nullish(),
});

export interface ExaWebSearchProviderOptions {
  apiKey: string;
}

/**
 * Exa Search + Contents over the REST API, routed through the SSRF guard.
 * Queries are sent verbatim: Exa honors site:, -site:, -term and "exact phrase" in the query text,
 * only weakly honors filetype:, and ignores intitle:.
 */
export class ExaWebSearchProvider implements IWebSearchProvider {
  readonly id = WebSearchProviders.Exa;
  readonly #apiKey: string;

  constructor(options: ExaWebSearchProviderOptions) {
    this.#apiKey = options.apiKey;
  }

  async search(input: { search_queries: string[]; objective: string | undefined }): Promise<WebSearchHits> {
    const perQuery = await Promise.all(
      input.search_queries.map(async query => {
        const json = await this.#post({
          path: '/search',
          body: {
            query,
            type: 'auto',
            numResults: EXA_SEARCH_MAX_RESULTS,
            contents: {
              highlights: {
                maxCharacters: EXA_SEARCH_MAX_CHARS_PER_RESULT,
                ...(input.objective ? { query: input.objective } : {}),
              },
            },
          },
        });
        return ExaSearchResponseSchema.parse(json).results;
      }),
    );

    // Interleave so every query is represented before the cap, then drop duplicate URLs across queries.
    const hits: WebSearchHit[] = [];
    const seenUrls = new Set<string>();
    const longest = Math.max(0, ...perQuery.map(results => results.length));
    for (let rank = 0; rank < longest && hits.length < EXA_SEARCH_MAX_RESULTS; rank += 1) {
      for (const results of perQuery) {
        const result = results[rank];
        if (result === undefined || seenUrls.has(result.url) || hits.length >= EXA_SEARCH_MAX_RESULTS) {
          continue;
        }
        seenUrls.add(result.url);
        hits.push({
          title: result.title ?? '',
          url: result.url,
          snippet: (result.highlights ?? []).join('\n\n'),
          published_at: result.publishedDate ?? null,
        });
      }
    }
    return { hits };
  }

  async fetch(input: { urls: string[]; objective: string | undefined }): Promise<WebFetchPages> {
    const json = await this.#post({ path: '/contents', body: { urls: input.urls, text: true } });
    const response = ExaContentsResponseSchema.parse(json);

    const failedUrls = new Set<string>();
    const pages: WebFetchPage[] = [];
    for (const status of response.statuses ?? []) {
      if (status.status !== 'error') {
        continue;
      }
      failedUrls.add(status.id);
      const httpStatus = status.error?.httpStatusCode;
      pages.push({
        url: status.id,
        title: null,
        content: '',
        error: [status.error?.tag ?? 'UNKNOWN_ERROR', httpStatus ? `(HTTP ${String(httpStatus)})` : undefined]
          .filter(Boolean)
          .join(' '),
      });
    }
    for (const result of response.results) {
      if (failedUrls.has(result.url)) {
        continue;
      }
      pages.push({ url: result.url, title: result.title ?? null, content: result.text ?? '', error: null });
    }
    return { pages };
  }

  async #post({ path, body }: { path: string; body: unknown }): Promise<unknown> {
    const response = await ssrfFetch(`${EXA_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.#apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await describeExaError(response));
    }
    return response.json();
  }
}

async function describeExaError(response: Response): Promise<string> {
  if (response.status === 401) {
    return 'Exa rejected the API key (401 Unauthorized). Check the configured Exa API key.';
  }
  if (response.status === 402) {
    return 'Exa request failed (402 Payment Required): the Exa account is out of credits.';
  }
  const detail = (await response.text().catch(() => '')).slice(0, EXA_ERROR_BODY_MAX_CHARS);
  return `Exa request failed (${String(response.status)})${detail ? `: ${detail}` : ''}`;
}
