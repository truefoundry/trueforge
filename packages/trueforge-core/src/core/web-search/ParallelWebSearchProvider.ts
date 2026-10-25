import Parallel from 'parallel-web';
import { elapsedSeconds, getOperationMetrics, type ParallelWebOperation } from '../observability/operationMetrics';
import { ssrfFetch } from '../util/outboundFetch';
import {
  WebSearchProviders,
  type IWebSearchProvider,
  type WebFetchPages,
  type WebSearchHits,
} from './WebSearchProvider';

export type ParallelSearchMode = 'turbo' | 'fast' | 'basic' | 'advanced';

/** Keep search payloads under the large-tool-response individual threshold (~6k tokens). */
const PARALLEL_SEARCH_MAX_RESULTS = 5;
const PARALLEL_SEARCH_MAX_CHARS_PER_RESULT = 500;
const PARALLEL_SEARCH_MAX_CHARS_TOTAL = 4000;

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
    this.#client = new Parallel({
      apiKey: options.apiKey,
      fetch: ssrfFetch,
    });
    this.#mode = options.mode;
  }

  async search(input: { search_queries: string[]; objective: string | undefined }): Promise<WebSearchHits> {
    const response = await this.#observe('search', () =>
      this.#client.search({
        search_queries: input.search_queries,
        ...(input.objective ? { objective: input.objective } : {}),
        mode: this.#mode,
        max_chars_total: PARALLEL_SEARCH_MAX_CHARS_TOTAL,
        advanced_settings: {
          max_results: PARALLEL_SEARCH_MAX_RESULTS,
          excerpt_settings: { max_chars_per_result: PARALLEL_SEARCH_MAX_CHARS_PER_RESULT },
        },
      }),
    );
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
    const response = await this.#observe(
      'extract',
      () =>
        this.#client.extract({
          urls: input.urls,
          ...(input.objective ? { objective: input.objective } : {}),
        }),
      result => result.errors.length,
    );
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

  async #observe<T>(
    operation: ParallelWebOperation,
    run: () => Promise<T>,
    partialErrorCount?: (result: T) => number,
  ): Promise<T> {
    const metrics = getOperationMetrics();
    if (metrics === undefined) {
      return run();
    }
    const startedMs = performance.now();
    try {
      const result = await run();
      metrics.recordParallelWebRequest({
        operation,
        outcome: 'success',
        durationSeconds: elapsedSeconds(startedMs),
      });
      const partialErrors = partialErrorCount === undefined ? 0 : partialErrorCount(result);
      if (partialErrors > 0) {
        metrics.recordParallelWebPartialErrors({ count: partialErrors });
      }
      return result;
    } catch (error) {
      metrics.recordParallelWebRequest({
        operation,
        outcome: 'error',
        durationSeconds: elapsedSeconds(startedMs),
      });
      throw error;
    }
  }
}
