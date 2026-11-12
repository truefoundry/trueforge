export function onSignalAbort(signal: AbortSignal | undefined, callback: () => void): void {
  if (!signal) {
    return;
  }
  if (signal.aborted) {
    callback();
    return;
  }
  signal.addEventListener('abort', callback, { once: true });
}

/** Resolves when `signal` aborts, or immediately if it already has. */
export function waitUntilAborted(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    onSignalAbort(signal, () => {
      resolve();
    });
  });
}
