'use client';

import { useEffect, useRef } from 'react';

/**
 * Poll `poll` on `intervalMs` while the document is visible.
 * Skips ticks while `document.hidden` or while the previous poll is still running.
 * Runs once immediately when the tab becomes visible again.
 */
export function useSessionListStatusPoll({
  intervalMs,
  poll,
}: {
  intervalMs: number | null;
  poll: () => void | Promise<void>;
}): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (intervalMs == null) return;

    let cancelled = false;
    let inFlight = false;
    let intervalId: number | undefined;

    const run = () => {
      if (cancelled || document.hidden || inFlight) return;
      let result: void | Promise<void>;
      try {
        result = pollRef.current();
      } catch {
        return;
      }
      // A poll that outlives the interval must not start another one on top of it.
      if (result == null || typeof result.then !== 'function') return;
      inFlight = true;
      void result.finally(() => {
        inFlight = false;
      });
    };

    const startInterval = () => {
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(run, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
        return;
      }
      run();
      startInterval();
    };

    run();
    if (!document.hidden) startInterval();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
