'use client';

import { useTrueFoundryHistoryPagination } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';

/** How close to the viewport top (px) before the next older page is fetched. */
const TOP_THRESHOLD_PX = 200;

const VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';

/**
 * Renders `HistoryLoader` at the top of the message list and fetches
 * the next older history page when the user scrolls near it. Scroll position
 * is preserved across the prepend so the list doesn't jump.
 *
 * Must be rendered inside `ThreadViewportShell` (it locates the scroll root
 * via the `aui_thread-viewport` data-slot on its nearest scrollable ancestor).
 */
export function HistoryLoaderContainer() {
  const HistoryLoader = useSlot('HistoryLoader');
  const { hasOlderHistory, isLoadingOlderHistory, loadOlderHistory } = useTrueFoundryHistoryPagination();

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const inflightRef = useRef(false);

  const maybeLoadOlder = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const viewport = sentinel?.closest<HTMLElement>(VIEWPORT_SELECTOR) ?? null;
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;

    try {
      await loadOlderHistory();
      // Wait for React to commit the prepended messages, then restore the
      // user's anchor so the list doesn't jump to the oldest message.
      requestAnimationFrame(() => {
        if (viewport == null) return;
        const delta = viewport.scrollHeight - prevScrollHeight;
        if (delta > 0) {
          viewport.scrollTo({ top: prevScrollTop + delta, behavior: 'instant' });
        }
      });
    } catch {
      // Runtime surfaces the error via onError; the sentinel stays retryable.
    } finally {
      inflightRef.current = false;
    }
  }, [sentinel, loadOlderHistory]);

  useEffect(() => {
    if (sentinel == null || !hasOlderHistory) return;

    const viewport = sentinel.closest<HTMLElement>(VIEWPORT_SELECTOR);
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void maybeLoadOlder();
        }
      },
      { root: viewport, rootMargin: `${TOP_THRESHOLD_PX}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasOlderHistory, maybeLoadOlder]);

  if (!hasOlderHistory) return null;

  return <HistoryLoader ref={setSentinel} isLoading={isLoadingOlderHistory} />;
}
