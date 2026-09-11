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

/** Drain every `searchAgents` page (offset pagination). */
export async function searchAllAgents(
  server: Pick<AgentBuilderServer, 'searchAgents'>,
  offset = 0,
): Promise<AgentLibraryEntry[]> {
  const rows = await server.searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE, offset });
  if (rows.length < SEARCH_AGENTS_PAGE_SIZE) return rows;
  return [...rows, ...(await searchAllAgents(server, offset + rows.length))];
}

/** Exact-name lookup walks server-filtered pages until a precise match is found. */
export async function findAgentByName({
  server,
  agentName,
  offset = 0,
}: {
  server: Pick<AgentBuilderServer, 'searchAgents'>;
  agentName: string;
  offset?: number;
}): Promise<AgentLibraryEntry | undefined> {
  const rows = await server.searchAgents({ query: agentName, limit: SEARCH_AGENTS_PAGE_SIZE, offset });
  const match = rows.find(agent => agent.name === agentName);
  if (match != null || rows.length < SEARCH_AGENTS_PAGE_SIZE) return match;
  return findAgentByName({ server, agentName, offset: offset + rows.length });
}

/** Resolve by agent id or exact name by walking unfiltered pages (ids are not name-searchable). */
export async function findLibraryAgent({
  server,
  agentKey,
  offset = 0,
}: {
  server: Pick<AgentBuilderServer, 'searchAgents'>;
  agentKey: string;
  offset?: number;
}): Promise<AgentLibraryEntry | undefined> {
  const rows = await server.searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE, offset });
  const match = rows.find(agent => agent.name === agentKey || agent.agentId === agentKey);
  if (match != null || rows.length < SEARCH_AGENTS_PAGE_SIZE) return match;
  return findLibraryAgent({ server, agentKey, offset: offset + rows.length });
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
 * Debounced `searchAgents` with offset pagination.
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
  const [offset, setOffset] = useState(0);

  const genRef = useRef(0);
  const loadMoreInflightRef = useRef(false);
  const hasMoreRef = useRef(false);
  const agentsLenRef = useRef(0);
  const listElRef = useRef<HTMLElement | null>(null);
  const sentinelElRef = useRef<HTMLElement | null>(null);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

  const limit = mode === 'paged' ? pageSize : clampPageSize(limitOption);

  hasMoreRef.current = hasMore;
  agentsLenRef.current = agents.length;

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
    setOffset(0);
  }, [mode, searchQuery, refreshKey]);

  useEffect(() => {
    if (!enabled || server == null) return;

    const gen = ++genRef.current;
    loadMoreInflightRef.current = false;
    setLoading(true);
    setError(null);

    const fetchOffset = mode === 'paged' ? offset : 0;

    void server
      .searchAgents({ query: searchQuery, limit, offset: fetchOffset })
      .then(rows => {
        if (gen !== genRef.current) return;
        setAgents(rows);
        setHasMore(rows.length >= limit);
      })
      .catch((err: unknown) => {
        if (gen !== genRef.current) return;
        setAgents([]);
        setHasMore(false);
        setError(getErrorMessage(err, 'Failed to load agents.'));
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false);
      });

    return () => {
      genRef.current += 1;
    };
  }, [enabled, server, searchQuery, limit, refreshKey, mode, offset]);

  const loadMore = useCallback(() => {
    if (mode !== 'infinite') return;
    if (!enabled || server == null || !hasMoreRef.current || loadMoreInflightRef.current || loading) {
      return;
    }

    const gen = genRef.current;
    const nextOffset = agentsLenRef.current;
    loadMoreInflightRef.current = true;
    setLoadingMore(true);

    void server
      .searchAgents({ query: searchQuery, limit, offset: nextOffset })
      .then(rows => {
        if (gen !== genRef.current) return;
        setAgents(prev => [...prev, ...rows]);
        setHasMore(rows.length >= limit);
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
    setOffset(0);
  }, []);

  const goNext = useCallback(() => {
    if (mode !== 'paged' || !hasMoreRef.current || loading) return;
    setOffset(current => current + pageSize);
  }, [mode, loading, pageSize]);

  const goPrev = useCallback(() => {
    if (mode !== 'paged' || loading) return;
    setOffset(current => Math.max(0, current - pageSize));
  }, [mode, loading, pageSize]);

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
    canPrev: mode === 'paged' && offset > 0,
    canNext: mode === 'paged' && hasMore,
    goPrev,
    goNext,
  };
}
