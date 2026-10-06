/** Consecutive subscribe attempts after a live SSE drop before the UI reports failure. */
export const STREAM_RECONNECT_MAX_ATTEMPTS = 3;

/** Abortable pause between reconnect attempts. */
export const STREAM_RECONNECT_DELAY_MS = 500;

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function delayReconnect(signal: AbortSignal, delayMs = STREAM_RECONNECT_DELAY_MS): Promise<void> {
  if (signal.aborted || delayMs <= 0) {
    return;
  }
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
