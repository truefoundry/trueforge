/**
 * Report a failed session open. Prefer host `onError` when provided; fall back
 * to toaster `showError`. The backend message is shown as-is.
 */
export function reportSessionAccessError({
  error,
  onError,
  showError,
}: {
  error: unknown;
  onError?: (error: unknown) => void;
  showError?: (error: unknown) => void;
}): void {
  const report = onError ?? showError;
  report?.(error);
}
