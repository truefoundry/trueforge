import type { SessionState } from './authSession';

/** Reads `/?error=<reason>` from OIDC login failures. Returns null when not an error landing. */
export function parseAuthErrorReason(search: string): string | null {
  const reason = new URLSearchParams(search).get('error')?.trim();
  if (!reason) {
    return null;
  }
  return reason;
}

/** True only for a real login failure: `?error=` present and no valid session. */
export function shouldShowAuthErrorScreen({
  authError,
  session,
}: {
  authError: string | null;
  session: SessionState | 'checking';
}): boolean {
  return authError != null && session === 'unauthenticated';
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
