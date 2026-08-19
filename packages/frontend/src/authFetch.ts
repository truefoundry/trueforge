/**
 * Browser auth entry points. Login and logout are not SDK methods (cookie session).
 * On any HTTP 401, redirect to OIDC login (session required).
 */

/** Browser entry for OIDC login (not available as an SDK method). */
export const AUTH_LOGIN_HREF = '/api/v1/auth/login';

/** Clears the local session cookie (not available as an SDK method). */
export const AUTH_LOGOUT_HREF = '/api/v1/auth/logout';

export function createAuthAwareFetch(baseFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  let redirecting = false;

  return async (input, init) => {
    const response = await baseFetch(input, init);

    if (response.status !== 401 || typeof window === 'undefined') {
      return response;
    }

    if (!redirecting) {
      redirecting = true;
      window.location.assign(AUTH_LOGIN_HREF);
    }

    // Do not surface 401 to callers — boot would flash a config error before navigation.
    return new Promise<Response>(resolve => {
      void resolve;
    });
  };
}
