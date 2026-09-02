/**
 * Browser auth entry points. Login and logout are not SDK methods (cookie session).
 * On any HTTP 401, redirect to OIDC login (session required).
 *
 * API paths stay at `/api/...` even when the UI is mounted under a public path
 * (Caddy strips `/trueforge` before Harness). Pass `return_to` so post-login
 * lands back under that UI path.
 */
import { UI_BASE_PATH } from './publicPath';

/** Browser entry for OIDC login (not available as an SDK method). */
export const AUTH_LOGIN_HREF = '/api/v1/auth/login';

/** Clears the local session cookie (not available as an SDK method). */
export const AUTH_LOGOUT_HREF = '/api/v1/auth/logout';

/** Login URL with a same-origin `return_to` (defaults to the UI home). */
export function buildLoginHref(returnTo: string = UI_BASE_PATH): string {
  const params = new URLSearchParams({ return_to: returnTo });
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
