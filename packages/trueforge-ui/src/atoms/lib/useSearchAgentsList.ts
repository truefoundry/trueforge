'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentBuilderServer, AgentLibraryEntry } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useDebouncedValue } from './useDebouncedValue.js';

/** Matches API AGENTS_PAGE_DEFAULT / AGENTS_PAGE_LIMIT. */
export const SEARCH_AGENTS_PAGE_SIZE = 50;
export const SEARCH_AGENTS_PAGE_MAX = 100;
const DEFAULT_DEBOUNCE_MS = 300;
const LOAD_MORE_ROOT_MARGIN = '48px';

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), SEARCH_AGENTS_PAGE_MAX);
}

/** Drain every `searchAgents` page (token pagination). */
export async function searchAllAgents(
  server: Pick<AgentBuilderServer, 'searchAgents'>,
  pageToken?: string,
): Promise<AgentLibraryEntry[]> {
  const page = await server.searchAgents({
    limit: SEARCH_AGENTS_PAGE_SIZE,
    ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
  });
  if (page.nextPageToken == null || page.nextPageToken === '') return page.data;
  return [...page.data, ...(await searchAllAgents(server, page.nextPageToken))];
}

/** Exact-name lookup walks server-filtered pages until a precise match is found. */
export async function findAgentByName({
  server,
  agentName,
  pageToken,
}: {
  server: Pick<AgentBuilderServer, 'searchAgents'>;
  agentName: string;
  pageToken?: string;
}): Promise<AgentLibraryEntry | undefined> {
  const page = await server.searchAgents({
    query: agentName,
    limit: SEARCH_AGENTS_PAGE_SIZE,
    ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
  });
  const match = page.data.find(agent => agent.name === agentName);
  if (match != null || page.nextPageToken == null || page.nextPageToken === '') return match;
  return findAgentByName({ server, agentName, pageToken: page.nextPageToken });
}

/** Resolve by agent id or exact name by walking unfiltered pages (ids are not name-searchable). */
export async function findLibraryAgent({
  server,
  agentKey,
  pageToken,
}: {
  server: Pick<AgentBuilderServer, 'searchAgents'>;
  agentKey: string;
  pageToken?: string;
}): Promise<AgentLibraryEntry | undefined> {
  const page = await server.searchAgents({
    limit: SEARCH_AGENTS_PAGE_SIZE,
    ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
  });
  const match = page.data.find(agent => agent.name === agentKey || agent.agentId === agentKey);
  if (match != null || page.nextPageToken == null || page.nextPageToken === '') return match;
  return findLibraryAgent({ server, agentKey, pageToken: page.nextPageToken });
}

export type UseSearchAgentsListOptions = {
  /** When false, no fetches run. */
  enabled: boolean;
  query: string;
  /** Bump to force a replace fetch (e.g. agentsListEpoch). */
  refreshKey?: number;
  /** Page size for infinite mode, or initial size for paged mode. Capped at 100. */
  limit?: number;
  debounceMs?: number;
  /**
   * `infinite` — append via IntersectionObserver sentinel (default).
   * `paged` — replace rows; navigate with goPrev / goNext.
   */
  mode?: 'infinite' | 'paged';
};

export type UseSearchAgentsListResult = {
  agents: AgentLibraryEntry[];
  /** True while the replace fetch is in flight and the list is still empty. */
  isInitialLoading: boolean;
  /** True while replacing results that are already on screen (softer than a skeleton wipe). */
  isSearching: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  listRef: (node: HTMLElement | null) => void;
  sentinelRef: (node: HTMLElement | null) => void;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  canPrev: boolean;
  canNext: boolean;
  goPrev: () => void;
  goNext: () => void;
};

/**
 * Debounced `searchAgents` with token pagination.
 * Infinite mode: attach `listRef` / `sentinelRef` for IntersectionObserver load-more.
 * Paged mode: use `goPrev` / `goNext` / `setPageSize` (rows replaced each fetch).
 */
export function useSearchAgentsList({
  enabled,
  query,
  refreshKey = 0,
  limit: limitOption = SEARCH_AGENTS_PAGE_SIZE,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mode = 'infinite',
}: UseSearchAgentsListOptions): UseSearchAgentsListResult {
  const server = useOptionalServer();
  // While closed, sync immediately so reopen never fetches a stale query.
  const debouncedQuery = useDebouncedValue(query, enabled ? debounceMs : 0);

  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize, setPageSizeState] = useState(() => clampPageSize(limitOption));
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [previousPageToken, setPreviousPageToken] = useState<string | undefined>(undefined);

  const genRef = useRef(0);
  const loadMoreInflightRef = useRef(false);
  const hasMoreRef = useRef(false);
  const nextPageTokenRef = useRef<string | undefined>(undefined);
  const listElRef = useRef<HTMLElement | null>(null);
  const sentinelElRef = useRef<HTMLElement | null>(null);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

  const limit = mode === 'paged' ? pageSize : clampPageSize(limitOption);

  hasMoreRef.current = hasMore;
  nextPageTokenRef.current = nextPageToken;

  const listRef = useCallback((node: HTMLElement | null) => {
    listElRef.current = node;
    setListEl(node);
  }, []);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelElRef.current = node;
    setSentinelEl(node);
  }, []);

  const searchQuery = debouncedQuery.trim() || undefined;

  // Reset to first page when the query or catalog epoch changes.
  useEffect(() => {
    if (mode !== 'paged') return;
    setPageToken(undefined);
  }, [mode, searchQuery, refreshKey]);

  useEffect(() => {
    if (!enabled || server == null) return;

    const gen = ++genRef.current;
    loadMoreInflightRef.current = false;
    setLoading(true);
    setError(null);

    const fetchToken = mode === 'paged' ? pageToken : undefined;

    void server
      .searchAgents({
        query: searchQuery,
        limit,
        ...(fetchToken === undefined || fetchToken === '' ? {} : { pageToken: fetchToken }),
      })
      .then(page => {
        if (gen !== genRef.current) return;
        setAgents(page.data);
        setNextPageToken(page.nextPageToken);
        setPreviousPageToken(page.previousPageToken);
        setHasMore(page.nextPageToken != null && page.nextPageToken !== '');
      })
      .catch((err: unknown) => {
        if (gen !== genRef.current) return;
        setAgents([]);
        setNextPageToken(undefined);
        setPreviousPageToken(undefined);
        setHasMore(false);
        setError(getErrorMessage(err, 'Failed to load agents.'));
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false);
      });

    return () => {
      genRef.current += 1;
    };
  }, [enabled, server, searchQuery, limit, refreshKey, mode, pageToken]);

  const loadMore = useCallback(() => {
    if (mode !== 'infinite') return;
    const token = nextPageTokenRef.current;
    if (
      !enabled ||
      server == null ||
      !hasMoreRef.current ||
      token == null ||
      token === '' ||
      loadMoreInflightRef.current ||
      loading
    ) {
      return;
    }

    const gen = genRef.current;
    loadMoreInflightRef.current = true;
    setLoadingMore(true);

    void server
      .searchAgents({ query: searchQuery, limit, pageToken: token })
      .then(page => {
        if (gen !== genRef.current) return;
        setAgents(prev => [...prev, ...page.data]);
        setNextPageToken(page.nextPageToken);
        setHasMore(page.nextPageToken != null && page.nextPageToken !== '');
      })
      .catch(() => {
        if (gen !== genRef.current) return;
        setHasMore(false);
      })
      .finally(() => {
        loadMoreInflightRef.current = false;
        if (gen === genRef.current) setLoadingMore(false);
      });
  }, [enabled, server, searchQuery, limit, loading, mode]);

  useEffect(() => {
    if (mode !== 'infinite' || !enabled || !hasMore || listEl == null || sentinelEl == null) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          loadMore();
        }
      },
      { root: listEl, rootMargin: LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [mode, enabled, hasMore, listEl, sentinelEl, loadMore, agents.length]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(clampPageSize(size));
    setPageToken(undefined);
  }, []);

  const goNext = useCallback(() => {
    if (mode !== 'paged' || loading) return;
    const token = nextPageTokenRef.current;
    if (token == null || token === '') return;
    setPageToken(token);
  }, [mode, loading]);

  const goPrev = useCallback(() => {
    if (mode !== 'paged' || loading) return;
    setPageToken(previousPageToken === undefined || previousPageToken === '' ? undefined : previousPageToken);
  }, [mode, loading, previousPageToken]);

  return {
    agents,
    isInitialLoading: loading && agents.length === 0,
    isSearching: loading && agents.length > 0,
    loadingMore,
    error,
    hasMore,
    listRef,
    sentinelRef,
    pageSize,
    setPageSize,
    canPrev: mode === 'paged' && previousPageToken != null && previousPageToken !== '',
    canNext: mode === 'paged' && nextPageToken != null && nextPageToken !== '',
    goPrev,
    goNext,
  };
}
