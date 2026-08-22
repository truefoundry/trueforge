export function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function onSignalAbort(signal: AbortSignal | undefined, callback: () => void): () => void {
  if (!signal) {
    return () => undefined;
  }
  if (signal.aborted) {
    callback();
    return () => undefined;
  }
  signal.addEventListener('abort', callback, { once: true });
  return () => {
    signal.removeEventListener('abort', callback);
  };
}
