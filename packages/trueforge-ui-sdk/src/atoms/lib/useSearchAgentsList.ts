'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentLibraryEntry } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useDebouncedValue } from './useDebouncedValue.js';

export const SEARCH_AGENTS_PAGE_SIZE = 50;
const DEFAULT_DEBOUNCE_MS = 300;
const LOAD_MORE_ROOT_MARGIN = '48px';

export type UseSearchAgentsListOptions = {
  /** When false, no fetches run. */
  enabled: boolean;
  query: string;
  /** Bump to force a replace fetch (e.g. agentsListEpoch). */
  refreshKey?: number;
  limit?: number;
  debounceMs?: number;
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
};

/**
 * Debounced `searchAgents` with offset pagination and an IntersectionObserver sentinel.
 * Attach `listRef` to the scroll container and `sentinelRef` to a footer element.
 */
export function useSearchAgentsList({
  enabled,
  query,
  refreshKey = 0,
  limit = SEARCH_AGENTS_PAGE_SIZE,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseSearchAgentsListOptions): UseSearchAgentsListResult {
  const server = useOptionalServer();
  // While closed, sync immediately so reopen never fetches a stale query.
  const debouncedQuery = useDebouncedValue(query, enabled ? debounceMs : 0);

  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const genRef = useRef(0);
  const loadMoreInflightRef = useRef(false);
  const hasMoreRef = useRef(false);
  const agentsLenRef = useRef(0);
  const listElRef = useRef<HTMLElement | null>(null);
  const sentinelElRef = useRef<HTMLElement | null>(null);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!enabled || server == null) return;

    const gen = ++genRef.current;
    loadMoreInflightRef.current = false;
    setLoading(true);
    setError(null);

    void server
      .searchAgents({ query: searchQuery, limit, offset: 0 })
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
  }, [enabled, server, searchQuery, limit, refreshKey]);

  const loadMore = useCallback(() => {
    if (!enabled || server == null || !hasMoreRef.current || loadMoreInflightRef.current || loading) {
      return;
    }

    const gen = genRef.current;
    const offset = agentsLenRef.current;
    loadMoreInflightRef.current = true;
    setLoadingMore(true);

    void server
      .searchAgents({ query: searchQuery, limit, offset })
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
  }, [enabled, server, searchQuery, limit, loading]);

  useEffect(() => {
    if (!enabled || !hasMore || listEl == null || sentinelEl == null) return;

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
  }, [enabled, hasMore, listEl, sentinelEl, loadMore, agents.length]);

  return {
    agents,
    isInitialLoading: loading && agents.length === 0,
    isSearching: loading && agents.length > 0,
    loadingMore,
    error,
    hasMore,
    listRef,
    sentinelRef,
  };
}
