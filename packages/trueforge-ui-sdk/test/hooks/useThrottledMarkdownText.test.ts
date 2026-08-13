'use client';

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LARGE_MARKDOWN_THROTTLE_MS, useThrottledMarkdownText } from '@/hooks/useThrottledMarkdownText.js';

describe('useThrottledMarkdownText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors text immediately when pacing is disabled', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useThrottledMarkdownText(text, { enabled: false, isComplete: false }),
      { initialProps: { text: 'hello' } },
    );

    expect(result.current).toBe('hello');
    rerender({ text: 'hello world' });
    expect(result.current).toBe('hello world');
  });

  it('seeds immediately with the latest raw text when pacing activates', () => {
    const { result, rerender } = renderHook(
      ({ text, enabled }) => useThrottledMarkdownText(text, { enabled, isComplete: false }),
      { initialProps: { text: 'smooth prefix', enabled: false } },
    );

    const jumped = `smooth prefix${'x'.repeat(100)}`;
    rerender({ text: jumped, enabled: true });
    expect(result.current).toBe(jumped);
  });

  it('holds rapid updates inside the throttle window when enabled', () => {
    const { result, rerender } = renderHook(
      ({ text }) =>
        useThrottledMarkdownText(text, {
          enabled: true,
          isComplete: false,
          throttleMs: LARGE_MARKDOWN_THROTTLE_MS,
        }),
      { initialProps: { text: 'a'.repeat(100) } },
    );

    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender({ text: 'a'.repeat(200) });
    expect(result.current).toBe(first);

    act(() => {
      vi.advanceTimersByTime(LARGE_MARKDOWN_THROTTLE_MS);
    });
    expect(result.current).toBe('a'.repeat(200));
  });

  it('never rewinds the committed prefix while paced', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useThrottledMarkdownText(text, { enabled: true, isComplete: false }),
      { initialProps: { text: 'abcdef' } },
    );

    expect(result.current).toBe('abcdef');
    rerender({ text: 'abc' });
    expect(result.current).toBe('abcdef');
  });

  it('flushes the exact final text when the stream completes', () => {
    const { result, rerender } = renderHook(
      ({ text, isComplete }) => useThrottledMarkdownText(text, { enabled: true, isComplete }),
      { initialProps: { text: 'partial', isComplete: false } },
    );

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender({ text: 'partial final document', isComplete: true });

    expect(result.current).toBe('partial final document');
  });
});
