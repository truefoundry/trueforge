// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInfiniteScrollSentinel } from '@/atoms/lib/useInfiniteScrollSentinel.js';

type ObserverCallback = IntersectionObserverCallback;

let observerCallback: ObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observerCallback = callback;
  }
  observe = observe;
  unobserve = vi.fn();
  disconnect = disconnect;
  takeRecords = () => [];
  root = null;
  rootMargin = '';
  thresholds = [];
}

function Probe({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}): ReactElement {
  const { listRef, sentinelRef } = useInfiniteScrollSentinel({
    enabled: true,
    hasMore,
    loading,
    onLoadMore,
  });
  return (
    <div>
      <div ref={listRef} data-testid="list" />
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  );
}

function ControlledProbe({ onLoadMore }: { onLoadMore: () => void }): ReactElement {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState(0);
  const hasMore = pages < 2;

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => {
      setPages(current => current + 1);
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading]);

  return (
    <Probe
      hasMore={hasMore}
      loading={loading}
      onLoadMore={() => {
        onLoadMore();
        setLoading(true);
      }}
    />
  );
}

describe('useInfiniteScrollSentinel', () => {
  beforeEach(() => {
    observerCallback = null;
    observe.mockClear();
    disconnect.mockClear();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-observes after loading settles so a still-visible sentinel can load again', async () => {
    const onLoadMore = vi.fn();
    render(<ControlledProbe onLoadMore={onLoadMore} />);

    await waitFor(() => expect(observe).toHaveBeenCalled());
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true, target: document.createElement('div') } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(observe.mock.calls.length).toBeGreaterThan(1));

    act(() => {
      observerCallback?.(
        [{ isIntersecting: true, target: document.createElement('div') } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(2));
  });
});
