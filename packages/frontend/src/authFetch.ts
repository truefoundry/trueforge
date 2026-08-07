/**
 * Browser auth entry points. Login is not an SDK method (302 browser flow).
 * On any HTTP 401, redirect to OIDC login (session required).
 */

/** Browser entry for OIDC login (not available as an SDK method). */
export const AUTH_LOGIN_HREF = '/api/v1/auth/login';

/** Post-logout landing (separate from login failure `?error=`). */
export const AUTH_LOGGED_OUT_HREF = '/?logged_out';

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
