import { safeReturnTo } from '../auth/safeReturnTo';
import { getPublicBaseUrl, getPublicUiBasePath } from '../config';

/** TrueFoundry platform browser login entry (same-origin path). */
export const TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH = '/signin/external';

/**
 * Resolve the `return_to` for TrueFoundry-mode `/auth/login`.
 * Preferred: callers send the platform login path (`/signin/external?redirectPath=…`).
 * App paths are wrapped for older/Vite-dev callers; missing/unsafe → login at UI home.
 */
export function resolveTrueFoundryLoginReturnTo(returnTo: string | undefined): string {
  if (returnTo !== undefined && returnTo !== '' && safeReturnTo(returnTo) === returnTo) {
    if (returnTo === TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH || returnTo.startsWith(`${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?`)) {
      return returnTo;
    }
    return `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?${new URLSearchParams({ redirectPath: returnTo }).toString()}`;
  }
  return `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?${new URLSearchParams({
    redirectPath: getPublicUiBasePath(),
  }).toString()}`;
}

/**
 * TrueFoundry platform browser login. Harness is mounted under the TF frontend
 * origin (e.g. `https://app.example.com/trueforge`); `returnTo` is the
 * same-origin path from the login request (typically `/signin/external?…`).
 */
export function buildTrueFoundryExternalLoginHref(returnTo: string): string {
  const publicUrl = new URL(getPublicBaseUrl());
  return `${publicUrl.origin}${returnTo}`;
}
