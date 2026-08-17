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
