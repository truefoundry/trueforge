// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionListStatusPoll } from '@/hooks/useSessionListStatusPoll.js';

describe('useSessionListStatusPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls immediately and on the interval while visible', () => {
    const poll = vi.fn();
    renderHook(() => useSessionListStatusPoll({ intervalMs: 10_000, poll }));

    expect(poll).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('does not poll while the document is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const poll = vi.fn();
    renderHook(() => useSessionListStatusPoll({ intervalMs: 10_000, poll }));

    expect(poll).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls immediately when the tab becomes visible again', () => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const poll = vi.fn();
    renderHook(() => useSessionListStatusPoll({ intervalMs: 10_000, poll }));
    expect(poll).not.toHaveBeenCalled();

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('does nothing when intervalMs is null', () => {
    const poll = vi.fn();
    renderHook(() => useSessionListStatusPoll({ intervalMs: null, poll }));
    expect(poll).not.toHaveBeenCalled();
  });
});
