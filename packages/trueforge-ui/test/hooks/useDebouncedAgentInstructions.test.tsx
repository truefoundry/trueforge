// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedAgentInstructions } from '@/hooks/useDebouncedAgentInstructions.js';

describe('useDebouncedAgentInstructions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits only the latest value after the debounce window', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedAgentInstructions({ value: '', onCommit, delayMs: 400 }));

    act(() => {
      result.current.onChange('B');
      result.current.onChange('Be');
      result.current.onChange('Be helpful');
      vi.advanceTimersByTime(399);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('Be helpful');
  });

  it('flushes pending input immediately without a later duplicate', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedAgentInstructions({ value: '', onCommit, delayMs: 400 }));

    act(() => {
      result.current.onChange('Latest');
      result.current.flush();
    });
    expect(onCommit).toHaveBeenCalledWith('Latest');

    act(() => vi.advanceTimersByTime(400));
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('does not flush when the commit callback changes identity during a rerender', () => {
    const firstCommit = vi.fn();
    const latestCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ onCommit }: { onCommit: (value: string) => void }) =>
        useDebouncedAgentInstructions({ value: '', onCommit, delayMs: 400 }),
      { initialProps: { onCommit: firstCommit } },
    );

    act(() => result.current.onChange('Debounced value'));
    rerender({ onCommit: latestCommit });

    expect(firstCommit).not.toHaveBeenCalled();
    expect(latestCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(firstCommit).not.toHaveBeenCalled();
    expect(latestCommit).toHaveBeenCalledWith('Debounced value');
  });

  it('commits pending input when the drawer unmounts', () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedAgentInstructions({ value: '', onCommit, delayMs: 400 }));

    act(() => result.current.onChange('Unsaved draft'));
    unmount();

    expect(onCommit).toHaveBeenCalledWith('Unsaved draft');
  });
});
