/** Supported host web-search backends (env `TRUEFOUNDRY_WEB_SEARCH_PROVIDER.name`). */
export enum WebSearchProviders {
  Parallel = 'parallel',
}

/** One search hit in the provider-normalized shape. */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
}

/** Normalized search response — stable across providers. */
export interface WebSearchHits {
  hits: WebSearchHit[];
}

/** One fetched page (or per-URL error) in the provider-normalized shape. */
export interface WebFetchPage {
  url: string;
  title: string | null;
  content: string;
  error: string | null;
}

/** Normalized fetch/extract response — stable across providers. */
export interface WebFetchPages {
  pages: WebFetchPage[];
}

/**
 * Host-supplied web search backend. Implementations map vendor APIs onto
 * {@link WebSearchHits} / {@link WebFetchPages} so the capability tools stay provider-agnostic.
 */
export interface IWebSearchProvider {
  readonly id: WebSearchProviders;
  search(input: { search_queries: string[]; objective: string | undefined }): Promise<WebSearchHits>;
  fetch(input: { urls: string[]; objective: string | undefined }): Promise<WebFetchPages>;
}
