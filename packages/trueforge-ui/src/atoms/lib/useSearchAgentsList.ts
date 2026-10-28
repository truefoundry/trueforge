'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentBuilderServer, AgentLibraryEntry, AgentUIServer } from '../../server/types.js';
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

const EMPTY_AGENTS: AgentLibraryEntry[] = [];

function requireServer(server: AgentUIServer | null): AgentUIServer {
  if (server == null) throw new Error('Agent search requires a server.');
  return server;
}

function nonEmptyToken(token: string | undefined): string | undefined {
  return token === undefined || token === '' ? undefined : token;
}

/**
 * Debounced, cached `searchAgents` with token pagination. Results refresh when the shell
 * invalidates the agents list.
 * Infinite mode: attach `listRef` / `sentinelRef` for IntersectionObserver load-more.
 * Paged mode: use `goPrev` / `goNext` / `setPageSize` (rows replaced each fetch).
 */
export function useSearchAgentsList({
  enabled,
  query,
  limit: limitOption = SEARCH_AGENTS_PAGE_SIZE,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mode = 'infinite',
}: UseSearchAgentsListOptions): UseSearchAgentsListResult {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  // While closed, sync immediately so reopen never fetches a stale query.
  const debouncedQuery = useDebouncedValue(query, enabled ? debounceMs : 0);
  const searchQuery = debouncedQuery.trim() || undefined;

  const [pageSize, setPageSizeState] = useState(() => clampPageSize(limitOption));
  // The token belongs to one query/size; a new search starts from the first page.
  const [pageCursor, setPageCursor] = useState<{ scope: string; token: string | undefined }>({
    scope: '',
    token: undefined,
  });
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

  const limit = mode === 'paged' ? pageSize : clampPageSize(limitOption);
  const pageScope = JSON.stringify([searchQuery ?? '', limit]);
  const pageToken = pageCursor.scope === pageScope ? pageCursor.token : undefined;
  const active = enabled && server != null;

  const pagedQuery = useQuery(
    {
      queryKey: queryKeys.agents.search({
        ...(searchQuery === undefined ? {} : { query: searchQuery }),
        limit,
        ...(pageToken === undefined ? {} : { pageToken }),
      }),
      queryFn: () =>
        requireServer(server).searchAgents({
          query: searchQuery,
          limit,
          ...(pageToken === undefined ? {} : { pageToken }),
        }),
      enabled: active && mode === 'paged',
      placeholderData: keepPreviousData,
    },
    queryClient,
  );

  const infiniteQuery = useInfiniteQuery(
    {
      queryKey: queryKeys.agents.searchPages({ ...(searchQuery === undefined ? {} : { query: searchQuery }), limit }),
      queryFn: ({ pageParam }) => {
        const token = nonEmptyToken(pageParam);
        return requireServer(server).searchAgents({
          query: searchQuery,
          limit,
          ...(token === undefined ? {} : { pageToken: token }),
        });
      },
      // Empty token means the first page.
      initialPageParam: '',
      getNextPageParam: lastPage => nonEmptyToken(lastPage.nextPageToken),
      enabled: active && mode === 'infinite',
      placeholderData: keepPreviousData,
    },
    queryClient,
  );

  const isPaged = mode === 'paged';
  const currentQuery = isPaged ? pagedQuery : infiniteQuery;
  const loading = active && (currentQuery.isPending || currentQuery.isPlaceholderData);
  const agents = isPaged
    ? (pagedQuery.data?.data ?? EMPTY_AGENTS)
    : (infiniteQuery.data?.pages.flatMap(page => page.data) ?? EMPTY_AGENTS);
  // A failed load-more only stops paging; it does not replace the list with an error.
  const replaceError = isPaged || !infiniteQuery.isFetchNextPageError ? currentQuery.error : null;
  const error =
    active && replaceError != null ? getErrorMessage(replaceError, 'Check your connection and try again.') : null;
  const nextPageToken = nonEmptyToken(pagedQuery.data?.nextPageToken);
  const previousPageToken = nonEmptyToken(pagedQuery.data?.previousPageToken);
  const hasMore = isPaged
    ? nextPageToken !== undefined
    : infiniteQuery.hasNextPage && !infiniteQuery.isFetchNextPageError;
  const loadingMore = !isPaged && infiniteQuery.isFetchingNextPage;

  const { fetchNextPage } = infiniteQuery;
  const loadMore = useCallback(() => {
    if (isPaged || !active || !hasMore || loadingMore || loading) return;
    void fetchNextPage();
  }, [active, fetchNextPage, hasMore, isPaged, loading, loadingMore]);

  useEffect(() => {
    if (isPaged || !enabled || !hasMore || listEl == null || sentinelEl == null) return;

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
  }, [isPaged, enabled, hasMore, listEl, sentinelEl, loadMore, agents.length]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(clampPageSize(size));
  }, []);

  const goNext = useCallback(() => {
    if (!isPaged || loading || nextPageToken === undefined) return;
    setPageCursor({ scope: pageScope, token: nextPageToken });
  }, [isPaged, loading, nextPageToken, pageScope]);

  const goPrev = useCallback(() => {
    if (!isPaged || loading) return;
    setPageCursor({ scope: pageScope, token: previousPageToken });
  }, [isPaged, loading, pageScope, previousPageToken]);

  return {
    agents,
    isInitialLoading: loading && agents.length === 0,
    isSearching: loading && agents.length > 0,
    loadingMore,
    error,
    hasMore,
    listRef: setListEl,
    sentinelRef: setSentinelEl,
    pageSize,
    setPageSize,
    canPrev: isPaged && previousPageToken !== undefined,
    canNext: isPaged && nextPageToken !== undefined,
    goPrev,
    goNext,
  };
}
