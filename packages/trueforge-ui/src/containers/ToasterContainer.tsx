'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';

const MAX_TOAST_DESCRIPTION_CHARS = 480;
const MAX_VISIBLE_TOASTS = 5;
const SUCCESS_TOAST_TTL_MS = 3000;

type ToastContent = { title: string; description?: string };

type ToastItem = ToastContent & { id: string; variant: 'error' | 'success' };

type ToasterContextValue = {
  showError: (error: unknown) => void;
  showSuccess: (content: ToastContent) => void;
};

const ToasterContext = createContext<ToasterContextValue | null>(null);

let toastId = 0;
function nextToastId(): string {
  toastId += 1;
  return `toast-${toastId}`;
}

function truncateDescription(text: string): string {
  if (text.length <= MAX_TOAST_DESCRIPTION_CHARS) return text;
  return `${text.slice(0, MAX_TOAST_DESCRIPTION_CHARS - 1)}…`;
}

function isHttpLikeError(error: unknown): error is Error & { statusCode?: number; body?: unknown } {
  return error instanceof Error && ('statusCode' in error || 'body' in error);
}

/** `{ error: { message, code } }` is the server's error envelope; `code` marks a classified failure. */
function errorCodeFromBody(body: unknown): string | undefined {
  if (body == null || typeof body !== 'object') {
    return undefined;
  }
  const inner: unknown = Reflect.get(body, 'error');
  if (inner == null || typeof inner !== 'object') {
    return undefined;
  }
  const code: unknown = Reflect.get(inner, 'code');
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function normalizeError(error: unknown): ToastContent {
  if (isHttpLikeError(error)) {
    const statusCode = error.statusCode;
    if (statusCode != null || error.body != null) {
      const raw = getErrorMessage(error, 'The server returned an error.');
      // A classified failure already carries a written-for-humans message, so it becomes the
      // title; an unclassified one keeps the status prefix as the only context available.
      if (errorCodeFromBody(error.body) != null) {
        return { title: truncateDescription(raw) };
      }
      const title = statusCode != null ? `Request failed (${statusCode})` : 'Request failed';
      return { title, description: truncateDescription(raw) };
    }
  }

  return {
    title: 'Something went wrong',
    description: truncateDescription(getErrorMessage(error, 'An unexpected error occurred.')),
  };
}

export function ToasterProvider({ children }: { children: ReactNode }) {
  const Toast = useSlot('Toast');
  const ToastStack = useSlot('ToastStack');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showError = useCallback((error: unknown) => {
    console.error('[trueforge-ui]', error);
    const item: ToastItem = { id: nextToastId(), variant: 'error', ...normalizeError(error) };
    setToasts(prev => [...prev, item].slice(-MAX_VISIBLE_TOASTS));
  }, []);

  const showSuccess = useCallback(
    (content: ToastContent) => {
      const id = nextToastId();
      const item: ToastItem = { id, variant: 'success', ...content };
      setToasts(prev => [...prev, item].slice(-MAX_VISIBLE_TOASTS));
      // Success is a transient confirmation — auto-dismiss so it doesn't linger. Errors persist
      // (a dev may need to read or copy them).
      if (typeof window !== 'undefined') {
        window.setTimeout(() => dismiss(id), SUCCESS_TOAST_TTL_MS);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showError, showSuccess }), [showError, showSuccess]);

  return (
    <ToasterContext.Provider value={value}>
      {children}
      <ToastStack>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            title={toast.title}
            description={toast.description ?? ''}
            variant={toast.variant}
            open
            onOpenChange={open => {
              if (!open) dismiss(toast.id);
            }}
          />
        ))}
      </ToastStack>
    </ToasterContext.Provider>
  );
}

export function useToaster(): ToasterContextValue {
  const context = useContext(ToasterContext);
  if (context == null) {
    throw new Error('useToaster must be used within ToasterProvider');
  }
  return context;
}

/** Same as `useToaster`, but returns `null` instead of throwing outside `ToasterProvider`. */
export function useToasterOptional(): ToasterContextValue | null {
  return useContext(ToasterContext);
}
