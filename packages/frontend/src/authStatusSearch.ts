/** True when the URL is a logout landing (`/?logged_out`). */
export function isLoggedOutSearch(search: string): boolean {
  return new URLSearchParams(search).has('logged_out');
}

/** Reads `/?error=<reason>` from OIDC login failures. Returns null when not an error landing. */
export function parseAuthErrorReason(search: string): string | null {
  const reason = new URLSearchParams(search).get('error')?.trim();
  if (!reason) {
    return null;
  }
  return reason;
}
