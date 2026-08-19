import type { SessionState } from './authSession';

/** Reads `/?error=<reason>` from OIDC login failures. Returns null when not an error landing. */
export function parseAuthErrorReason(search: string): string | null {
  const reason = new URLSearchParams(search).get('error')?.trim();
  if (!reason) {
    return null;
  }
  return reason;
}

/** Returns the error reason when the auth error screen should show; otherwise null. */
export function shouldShowAuthErrorScreen({
  authError,
  session,
}: {
  authError: string | null;
  session: SessionState | 'checking';
}): string | null {
  if (authError == null || session !== 'unauthenticated') {
    return null;
  }
  return authError;
}

/** Path + search + hash with the OIDC `error` query removed. */
export function stripAuthErrorSearch({
  pathname,
  search,
  hash,
}: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const params = new URLSearchParams(search);
  params.delete('error');
  const nextSearch = params.toString();
  return `${pathname}${nextSearch === '' ? '' : `?${nextSearch}`}${hash}`;
}
