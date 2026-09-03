/**
 * Session helpers: SDK `auth.me()` plus POST logout under the public API base.
 * Login is not on the SDK (browser redirect to the login href).
 */
import { TrueForge as TrueForgeClient, type TrueForge } from '@truefoundry/trueforge-sdk';
import { AUTH_LOGOUT_HREF, createAuthAwareFetch } from './authFetch';
import { API_BASE_URL } from './publicPath';

/** Authenticated API client — 401 redirects to OIDC login. */
const authClient = new TrueForgeClient({
  baseUrl: API_BASE_URL,
  fetch: createAuthAwareFetch(),
});

/**
 * Client for the pre-boot session probe. Unlike {@link authClient} it does NOT
 * redirect on 401, so the welcome gate can observe the unauthenticated state.
 */
const probeClient = new TrueForgeClient({
  baseUrl: API_BASE_URL,
  fetch: globalThis.fetch.bind(globalThis),
});

/** Result of the pre-boot session probe. */
export type SessionState = 'authenticated' | 'unauthenticated';

/** Last successful me() OIDC check — survives remounts of host chrome. */
let cachedIsOidcConnected: boolean | undefined;

export function getCachedIsOidcConnectedSession(): boolean | undefined {
  return cachedIsOidcConnected;
}

/** Test-only: clear the module cache between cases. */
export function resetOidcSessionCacheForTests(): void {
  cachedIsOidcConnected = undefined;
}

/**
 * True when the current session is a browser OIDC login (`data.type: "oidc-connected"`).
 * When auth is enabled, unauthenticated callers get HTTP 401 from `/me`.
 */
export async function isOidcConnectedSession(client: TrueForge = authClient): Promise<boolean> {
  const { data } = await client.auth.me();
  const isConnected = data.type === 'oidc-connected';
  cachedIsOidcConnected = isConnected;
  return isConnected;
}

export async function logout(post: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  const response = await post(AUTH_LOGOUT_HREF, { method: 'POST', credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Logout failed (${String(response.status)})`);
  }
}

/**
 * Pre-boot gate: GET `/me` without the 401→login redirect.
 * Any failure (e.g. auth enabled but no session cookie yet) is treated as
 * unauthenticated so the app can render the welcome / "Let's Get Started" screen
 * rather than bouncing to login before the user asks for it.
 */
export async function probeSession(client: TrueForge = probeClient): Promise<SessionState> {
  try {
    await client.auth.me();
    return 'authenticated';
  } catch {
    return 'unauthenticated';
  }
}
