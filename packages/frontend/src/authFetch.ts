/**
 * Browser auth entry points. Login and logout are not SDK methods (cookie session).
 * On any HTTP 401, redirect to login (session required).
 *
 * Auth URLs share the public prefix with the UI (e.g. `/custom/proxy/path/api/v1/auth/...`).
 * A reverse proxy strips that prefix before Harness. Pass `return_to` so post-login
 * lands back under the UI path.
 *
 * TrueFoundry mode: `return_to` is the platform login path
 * (`/signin/external?redirectPath=…`), not the post-login landing alone.
 */
import { apiPath, documentAuthMode, UI_BASE_PATH } from './publicPath';

/** Browser entry for login (not available as an SDK method). */
export const AUTH_LOGIN_HREF = apiPath('/api/v1/auth/login');

/** Clears the local session cookie (not available as an SDK method). */
export const AUTH_LOGOUT_HREF = apiPath('/api/v1/auth/logout');

/** TrueFoundry platform browser login entry (same-origin path). */
const TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH = '/signin/external';

/** Login URL with a same-origin `return_to` (defaults to the UI home). */
export function buildLoginHref(returnTo: string = UI_BASE_PATH): string {
  const return_to =
    documentAuthMode() === 'truefoundry'
      ? `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?${new URLSearchParams({ redirectPath: returnTo }).toString()}`
      : returnTo;
  const params = new URLSearchParams({ return_to });
  return `${AUTH_LOGIN_HREF}?${params.toString()}`;
}

export function createAuthAwareFetch(baseFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  let redirecting = false;

  return async (input, init) => {
    const response = await baseFetch(input, init);

    if (response.status !== 401 || typeof window === 'undefined') {
      return response;
    }

    if (!redirecting) {
      redirecting = true;
      window.location.assign(buildLoginHref(`${window.location.pathname}${window.location.search}`));
    }

    // Do not surface 401 to callers — boot would flash a config error before navigation.
    return new Promise<Response>(resolve => {
      void resolve;
    });
  };
}
