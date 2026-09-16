import Parallel from 'parallel-web';
import {
  WebSearchProviders,
  type IWebSearchProvider,
  type WebFetchPages,
  type WebSearchHits,
} from './WebSearchProvider';

export type ParallelSearchMode = 'turbo' | 'fast' | 'basic' | 'advanced';

export interface ParallelWebSearchProviderOptions {
  apiKey: string;
  /** Parallel Search mode preset. Caller supplies the default (e.g. `turbo`). */
  mode: ParallelSearchMode;
}

/**
 * Parallel Search + Extract via the official `parallel-web` SDK.
 */
export class ParallelWebSearchProvider implements IWebSearchProvider {
  readonly id = WebSearchProviders.Parallel;
  readonly #client: Parallel;
  readonly #mode: ParallelSearchMode;

  constructor(options: ParallelWebSearchProviderOptions) {
    this.#client = new Parallel({ apiKey: options.apiKey });
    this.#mode = options.mode;
  }

  async search(input: { search_queries: string[]; objective: string | undefined }): Promise<WebSearchHits> {
    const response = await this.#client.search({
      search_queries: input.search_queries,
      ...(input.objective ? { objective: input.objective } : {}),
      mode: this.#mode,
    });
    return {
      hits: response.results.map(result => ({
        title: result.title ?? '',
        url: result.url,
        snippet: result.excerpts.join('\n\n'),
        published_at: result.publish_date ?? null,
      })),
    };
  }

  async fetch(input: { urls: string[]; objective: string | undefined }): Promise<WebFetchPages> {
    const response = await this.#client.extract({
      urls: input.urls,
      ...(input.objective ? { objective: input.objective } : {}),
    });
    const pages = [
      ...response.results.map(result => ({
        url: result.url,
        title: result.title ?? null,
        content: result.full_content ?? result.excerpts.join('\n\n'),
        error: null,
      })),
      ...response.errors.map(err => ({
        url: err.url,
        title: null,
        content: '',
        error: err.content ?? err.error_type,
      })),
    ];
    return { pages };
  }
}
