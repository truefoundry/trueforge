/** Reads `/?error=<reason>` from OIDC login failures. Returns null when not an error landing. */
export function parseAuthErrorReason(search: string): string | null {
  const reason = new URLSearchParams(search).get('error')?.trim();
  if (!reason) {
    return null;
  }
  return reason;
}
