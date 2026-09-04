'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_ROOT_MARGIN = '48px';

export type UseInfiniteScrollSentinelOptions = {
  enabled: boolean;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
};

/**
 * IntersectionObserver sentinel for linear infinite-scroll lists.
 * Attach `listRef` to the scroll container and `sentinelRef` to a footer element.
 * Re-observes when `hasMore` / `loading` change so a still-visible sentinel (short
 * filtered lists) continues requesting pages after each load settles.
 */
export function useInfiniteScrollSentinel({
  enabled,
  hasMore,
  loading,
  onLoadMore,
  rootMargin = DEFAULT_ROOT_MARGIN,
}: UseInfiniteScrollSentinelOptions): {
  listRef: (node: HTMLElement | null) => void;
  sentinelRef: (node: HTMLElement | null) => void;
} {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

  const listRef = useCallback((node: HTMLElement | null) => {
    setListEl(node);
  }, []);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinelEl(node);
  }, []);

  useEffect(() => {
    if (!enabled || !hasMore || loading || listEl == null || sentinelEl == null) return;

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        onLoadMoreRef.current();
      },
      { root: listEl, rootMargin },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [enabled, hasMore, loading, listEl, sentinelEl, rootMargin]);

  return { listRef, sentinelRef };
}
