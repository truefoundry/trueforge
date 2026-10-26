import { getPublicUiBasePath } from '../config';

/**
 * Same-origin relative path only.
 * - starts with `/`
 * - not `//…` (open redirect)
 * - not `/api` or `/api/…`
 * - no `\`, tab, CR, or LF (browsers normalize these into host-switching redirects)
 */
const SAFE_RETURN_TO = /^\/(?!\/|api(?:\/|$)).*/;
const UNSAFE_RETURN_TO_CHARS = /[\\\t\r\n]/;

function isSafeReturnTo(value: string): boolean {
  return !UNSAFE_RETURN_TO_CHARS.test(value) && SAFE_RETURN_TO.test(value);
}

/** Same-origin path, or the public UI home when missing or unsafe. */
export function safeReturnTo(value: string | undefined): string {
  if (value && isSafeReturnTo(value)) {
    return value;
  }
  return getPublicUiBasePath();
}
