import { safeReturnTo } from '../auth/safeReturnTo';
import { getPublicUiBasePath } from '../config';

/** TrueFoundry platform browser login entry (same-origin path). */
export const TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH = '/signin/external';

/**
 * Resolve the platform login path for TrueFoundry-mode `/auth/login`.
 * `return_to` is the post-login app path; the server wraps it as
 * `/signin/external?redirectPath=…`. Missing/unsafe → UI home.
 */
export function resolveTrueFoundryLoginReturnTo(returnTo: string | undefined): string {
  const redirectPath =
    returnTo !== undefined && returnTo !== '' && safeReturnTo(returnTo) === returnTo ? returnTo : getPublicUiBasePath();
  return `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?${new URLSearchParams({ redirectPath }).toString()}`;
}
