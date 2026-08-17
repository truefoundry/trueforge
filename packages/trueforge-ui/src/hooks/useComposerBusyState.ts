'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ComposerBusyState = {
  /** True while submitting or while the turn stream is active. */
  isBusy: boolean;
  isRunning: boolean;
  isSubmitting: boolean;
  send: (sendFn: () => void | Promise<void>) => void;
  resetBusy: () => void;
};

const ComposerBusyContext = createContext<ComposerBusyState | null>(null);

/**
 * `aui.composer().send()` returns void and swallows `onNew` rejections, so the
 * optimistic submitting flag cannot clear via Promise.catch. First-message
 * failures (e.g. createSession) also never flip `useThreadIsRunning()`. Chat
 * runtime `onError` calls this so the Cancel/spinner state does not stick.
 */
const busyFailureListeners = new Set<() => void>();

export function notifyComposerBusyFailure(): void {
  for (const listener of busyFailureListeners) {
    listener();
  }
}

function useComposerBusyStateValue(): ComposerBusyState {
  const isRunning = useThreadIsRunning();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isRunning) {
      setIsSubmitting(false);
    }
  }, [isRunning]);

  useEffect(() => {
    const clearSubmitting = () => {
      setIsSubmitting(false);
    };
    busyFailureListeners.add(clearSubmitting);
    return () => {
      busyFailureListeners.delete(clearSubmitting);
    };
  }, []);

  const isBusy = isRunning || isSubmitting;

  const resetBusy = useCallback(() => {
    setIsSubmitting(false);
  }, []);

  const send = useCallback((sendFn: () => void | Promise<void>) => {
    setIsSubmitting(true);
    try {
      const result = sendFn();
      if (result != null && typeof result.then === 'function') {
        void result.catch(() => {
          setIsSubmitting(false);
        });
      }
    } catch {
      setIsSubmitting(false);
    }
  }, []);

  return { isBusy, isRunning, isSubmitting, send, resetBusy };
}

export function ComposerBusyProvider({ children }: { children: ReactNode }) {
  const value = useComposerBusyStateValue();
  return createElement(ComposerBusyContext.Provider, { value }, children);
}

/**
 * Optimistic composer busy state shared across the thread. `useThreadIsRunning()`
 * only becomes true once the turn stream starts; this hook flips to busy
 * immediately on submit so the send button shows loading before session setup /
 * turn API work finishes.
 *
 * Must be used within `<ComposerBusyProvider>` (wired by default in `<Thread />`).
 */
export function useComposerBusyState(): ComposerBusyState {
  const value = useContext(ComposerBusyContext);
  if (value == null) {
    throw new Error('useComposerBusyState must be used within ComposerBusyProvider');
  }
  return value;
}
