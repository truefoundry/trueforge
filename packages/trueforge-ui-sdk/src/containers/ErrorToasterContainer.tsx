'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';

const MAX_TOAST_DESCRIPTION_CHARS = 480;
const MAX_VISIBLE_TOASTS = 5;

type ErrorToastContent = { title: string; description: string };

type ErrorToastItem = ErrorToastContent & { id: string };

/**
 * `name` of the runtime error raised when a turn is still running but the
 * server cannot stream it. Owned by `@truefoundry/assistant-ui-runtime`
 * (`TURN_RESUME_UNSUPPORTED_ERROR_NAME`); matched by name so runtimes that
 * predate it keep falling back to a plain toast.
 */
const RESUME_UNSUPPORTED_ERROR_NAME = 'TurnResumeUnsupportedError';

type ErrorToasterContextValue = {
  showError: (error: unknown) => void;
  /** A response is generating that this backend cannot stream. */
  resumeUnavailable: boolean;
  dismissResumeUnavailable: () => void;
};

const ErrorToasterContext = createContext<ErrorToasterContextValue | null>(null);

let toastId = 0;
function nextToastId(): string {
  toastId += 1;
  return `error-toast-${toastId}`;
}

function truncateDescription(text: string): string {
  if (text.length <= MAX_TOAST_DESCRIPTION_CHARS) return text;
  return `${text.slice(0, MAX_TOAST_DESCRIPTION_CHARS - 1)}…`;
}

function isHttpLikeError(error: unknown): error is Error & { statusCode?: number; body?: unknown } {
  return error instanceof Error && ('statusCode' in error || 'body' in error);
}

function normalizeError(error: unknown): ErrorToastContent {
  if (isHttpLikeError(error)) {
    const statusCode = error.statusCode;
    if (statusCode != null || error.body != null) {
      const title = statusCode != null ? `Request failed (${statusCode})` : 'Request failed';
      const raw = getErrorMessage(error, 'The server returned an error.');
      return { title, description: truncateDescription(raw) };
    }
  }

  return {
    title: 'Something went wrong',
    description: truncateDescription(getErrorMessage(error, 'An unexpected error occurred.')),
  };
}

export function ErrorToasterProvider({ children }: { children: ReactNode }) {
  const Toast = useSlot('Toast');
  const ToastStack = useSlot('ToastStack');
  const [toasts, setToasts] = useState<ErrorToastItem[]>([]);
  const [resumeUnavailable, setResumeUnavailable] = useState(false);

  const showError = useCallback((error: unknown) => {
    console.error('[trueforge-ui]', error);
    // A transient toast would be missed here: the thread keeps showing a
    // running indicator that never resolves, so this needs its own modal.
    if (error instanceof Error && error.name === RESUME_UNSUPPORTED_ERROR_NAME) {
      setResumeUnavailable(true);
      return;
    }
    const item: ErrorToastItem = { id: nextToastId(), ...normalizeError(error) };
    setToasts(prev => [...prev, item].slice(-MAX_VISIBLE_TOASTS));
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const dismissResumeUnavailable = useCallback(() => setResumeUnavailable(false), []);

  const value = useMemo(
    () => ({ showError, resumeUnavailable, dismissResumeUnavailable }),
    [showError, resumeUnavailable, dismissResumeUnavailable],
  );

  return (
    <ErrorToasterContext.Provider value={value}>
      {children}
      <ToastStack>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            title={toast.title}
            description={toast.description}
            open
            onOpenChange={open => {
              if (!open) dismiss(toast.id);
            }}
          />
        ))}
      </ToastStack>
    </ErrorToasterContext.Provider>
  );
}

export function useErrorToaster(): ErrorToasterContextValue {
  const context = useContext(ErrorToasterContext);
  if (context == null) {
    throw new Error('useErrorToaster must be used within ErrorToasterProvider');
  }
  return context;
}

/** Same as `useErrorToaster`, but returns `null` instead of throwing outside `ErrorToasterProvider`. */
export function useErrorToasterOptional(): ErrorToasterContextValue | null {
  return useContext(ErrorToasterContext);
}
