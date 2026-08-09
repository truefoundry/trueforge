// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useThreadIsRunning = vi.fn(() => false);

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadIsRunning(),
}));

import { ComposerBusyProvider, notifyComposerBusyFailure, useComposerBusyState } from '@/hooks/useComposerBusyState.js';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ComposerBusyProvider, null, children);
}

describe('useComposerBusyState', () => {
  beforeEach(() => {
    useThreadIsRunning.mockReturnValue(false);
  });

  it('reflects a running thread without marking it as submitting', () => {
    useThreadIsRunning.mockReturnValue(true);
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    expect(result.current.isBusy).toBe(true);
    expect(result.current.isRunning).toBe(true);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('starts busy immediately on send before the thread is running', () => {
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      result.current.send(() => undefined);
    });

    expect(result.current.isBusy).toBe(true);
    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.isRunning).toBe(false);
  });

  it('clears submitting when the thread stops running', async () => {
    useThreadIsRunning.mockReturnValue(true);
    const { result, rerender } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      result.current.send(() => undefined);
    });

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
  });

  it('clears submitting when send rejects', async () => {
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      result.current.send(() => Promise.reject(new Error('send failed')));
    });

    expect(result.current.isBusy).toBe(true);

    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
  });

  it('clears submitting when send throws synchronously', () => {
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      result.current.send(() => {
        throw new Error('send failed');
      });
    });

    expect(result.current.isBusy).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('resetBusy clears optimistic submitting state', () => {
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      result.current.send(() => undefined);
    });
    expect(result.current.isBusy).toBe(true);

    act(() => {
      result.current.resetBusy();
    });
    expect(result.current.isBusy).toBe(false);
  });

  it('clears submitting on notifyComposerBusyFailure when send never starts a run', () => {
    const { result } = renderHook(() => useComposerBusyState(), { wrapper });

    act(() => {
      // Matches aui.composer().send(): void return, rejection swallowed upstream.
      result.current.send(() => undefined);
    });
    expect(result.current.isBusy).toBe(true);
    expect(result.current.isSubmitting).toBe(true);

    act(() => {
      notifyComposerBusyFailure();
    });

    expect(result.current.isBusy).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('requires ComposerBusyProvider', () => {
    expect(() => renderHook(() => useComposerBusyState())).toThrow(
      'useComposerBusyState must be used within ComposerBusyProvider',
    );
  });
});
