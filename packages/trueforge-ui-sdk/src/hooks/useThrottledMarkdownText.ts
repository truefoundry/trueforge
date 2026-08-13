'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Maximum tolerated gap between the raw stream and the typewriter reveal.
 * Beyond this point, animating every queued character delays the response noticeably, so the
 * container switches to paced snapshots of the latest raw prefix.
 */
export const MARKDOWN_SMOOTH_BACKLOG_CHARS = 4 * 1024;

/**
 * Limits catch-up rendering to roughly 10 updates per second: frequent enough to keep streamed
 * text responsive, while leaving enough main-thread time for full-document Markdown parsing and
 * syntax highlighting to finish before the next snapshot.
 */
export const LARGE_MARKDOWN_THROTTLE_MS = 100;

/**
 * Provides bounded latest-prefix snapshots after the typewriter reveal falls too far behind.
 *
 * Enabling the hook immediately catches up to the current raw prefix, then coalesces subsequent
 * stream updates to one commit per `throttleMs`. Completion always bypasses the timer so the final
 * document is exact. While disabled, the hook mirrors `text` and stays ready for a monotonic
 * transition into catch-up mode.
 */
export function useThrottledMarkdownText(
  text: string,
  {
    isComplete,
    enabled,
    throttleMs = LARGE_MARKDOWN_THROTTLE_MS,
  }: { isComplete: boolean; enabled: boolean; throttleMs?: number },
): string {
  const [committed, setCommitted] = useState(text);
  const lastCommittedRef = useRef(text);
  const lastCommitAtRef = useRef(Date.now());
  const pendingRef = useRef(text);
  const wasEnabledRef = useRef(enabled);

  useEffect(() => {
    pendingRef.current = text;

    const commit = (value: string) => {
      // A stale timer must never replace a newer visible prefix with an older one.
      if (value.length < lastCommittedRef.current.length && value !== lastCommittedRef.current) {
        return;
      }
      lastCommittedRef.current = value;
      lastCommitAtRef.current = Date.now();
      setCommitted(value);
    };

    if (!enabled) {
      wasEnabledRef.current = false;
      lastCommittedRef.current = text;
      lastCommitAtRef.current = Date.now();
      setCommitted(text);
      return;
    }

    // Clear the accumulated reveal backlog once; only future growth is throttled.
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      commit(text);
      return;
    }

    if (lastCommittedRef.current === text) return;

    if (isComplete) {
      commit(text);
      return;
    }

    const elapsed = Date.now() - lastCommitAtRef.current;
    if (elapsed >= throttleMs) {
      commit(text);
      return;
    }

    const id = setTimeout(() => {
      commit(pendingRef.current);
    }, throttleMs - elapsed);
    return () => clearTimeout(id);
  }, [text, isComplete, enabled, throttleMs]);

  return enabled ? committed : text;
}
