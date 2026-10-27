// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SLOW_ACTIVITY_AFTER_MS, useSlowActivityLabel } from '@/hooks/useSlowActivityLabel.js';

describe('useSlowActivityLabel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits a full minute before marking an activity slow', () => {
    expect(SLOW_ACTIVITY_AFTER_MS).toBe(60_000);

    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ label, activityKey, progressKey }) => useSlowActivityLabel({ label, activityKey, progressKey }),
      {
        initialProps: {
          label: 'Thinking...',
          activityKey: 'thinking' as string | null,
          progressKey: '1:reasoning:10' as string | null,
        },
      },
    );

    expect(result.current).toBe('Thinking...');

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS - 1);
    });
    expect(result.current).toBe('Thinking...');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('Taking longer than expected');

    rerender({ label: 'Working...', activityKey: 'tool:call-1', progressKey: '2:tool-call:0' });
    expect(result.current).toBe('Working...');

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS);
    });
    expect(result.current).toBe('Taking longer than expected');
  });

  it('keeps the working label while stream progress updates, then warns after a minute of silence', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ label, activityKey, progressKey }) => useSlowActivityLabel({ label, activityKey, progressKey }),
      {
        initialProps: {
          label: 'Working...',
          activityKey: 'tool:call-1' as string | null,
          progressKey: '1:tool-call:10' as string | null,
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS - 1);
    });
    expect(result.current).toBe('Working...');

    rerender({ label: 'Working...', activityKey: 'tool:call-1', progressKey: '1:tool-call:50' });
    expect(result.current).toBe('Working...');

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS - 1);
    });
    expect(result.current).toBe('Working...');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('Taking longer than expected');

    rerender({ label: 'Working...', activityKey: 'tool:call-1', progressKey: '1:tool-call:80' });
    expect(result.current).toBe('Working...');
  });

  it('does not mark a user or sub-agent wait as slow', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useSlowActivityLabel({ label: 'Waiting for your approval', activityKey: null }),
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS);
    });
    expect(result.current).toBe('Waiting for your approval');
  });
});
