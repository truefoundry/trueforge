/**
 * Browser auth entry points. Login and logout are not SDK methods (cookie session).
 * On any HTTP 401, redirect to login (session required).
 *
 * Auth URLs share the public prefix with the UI (e.g. `/custom/proxy/path/api/v1/auth/...`).
 * A reverse proxy strips that prefix before Harness. Pass `return_to` as the post-login
 * app path; the server applies TrueFoundry platform wrapping when needed.
 */
import { apiPath, UI_BASE_PATH } from './publicPath';

const TRUEFORGE_CLIENT_HEADER = 'x-trueforge-client';
const TRUEFORGE_BROWSER_CLIENT = 'browser';

/** Browser entry for login (not available as an SDK method). */
export const AUTH_LOGIN_HREF = apiPath('/api/v1/auth/login');

/** Clears the local session cookie (not available as an SDK method). */
export const AUTH_LOGOUT_HREF = apiPath('/api/v1/auth/logout');

/** Login URL with a same-origin post-login `return_to` (defaults to the UI home). */
export function buildLoginHref(returnTo: string = UI_BASE_PATH): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `${AUTH_LOGIN_HREF}?${params.toString()}`;
}

export function createAuthAwareFetch(baseFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  let redirecting = false;

  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => {
      headers.set(name, value);
    });
    headers.set(TRUEFORGE_CLIENT_HEADER, TRUEFORGE_BROWSER_CLIENT);
    const response = await baseFetch(input, { ...init, headers });

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
