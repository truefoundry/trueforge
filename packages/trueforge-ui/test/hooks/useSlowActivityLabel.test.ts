// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SLOW_ACTIVITY_AFTER_MS, useSlowActivityLabel } from '@/hooks/useSlowActivityLabel.js';

describe('useSlowActivityLabel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends the slow note after the activity stays the same, then resets on the next activity', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ label, activityKey }) => useSlowActivityLabel(label, activityKey), {
      initialProps: { label: 'Thinking...', activityKey: 'thinking' as string | null },
    });

    expect(result.current).toBe('Thinking...');

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS - 1);
    });
    expect(result.current).toBe('Thinking...');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('Thinking... · Taking longer than expected');

    rerender({ label: 'Working...', activityKey: 'tool:call-1' });
    expect(result.current).toBe('Working...');

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS);
    });
    expect(result.current).toBe('Working... · Taking longer than expected');
  });

  it('does not mark a user or sub-agent wait as slow', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSlowActivityLabel('Waiting for your approval', null));

    act(() => {
      vi.advanceTimersByTime(SLOW_ACTIVITY_AFTER_MS);
    });
    expect(result.current).toBe('Waiting for your approval');
  });
});
