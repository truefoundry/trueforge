/**
 * Session helpers: SDK `auth.me()` / `auth.logout()` only.
 * Login is not on the SDK (browser redirect to `/api/v1/auth/login`).
 */
import { TrueForge as TrueForgeClient, type TrueForge, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { createAuthAwareFetch } from './authFetch';

export type MeResponse = TrueForgeApi.MeResponse;

const DEFAULT_BASE_URL = '/';

/** Authenticated API client — 401 redirects to OIDC login. */
const authClient = new TrueForgeClient({
  baseUrl: DEFAULT_BASE_URL,
  fetch: createAuthAwareFetch(),
});

/**
 * Client for the pre-boot session probe. Unlike {@link authClient} it does NOT
 * redirect on 401, so the welcome gate can observe the unauthenticated state.
 */
const probeClient = new TrueForgeClient({
  baseUrl: DEFAULT_BASE_URL,
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
 * True when the current session is a browser OIDC login (`type: "oidc-connected"`).
 * When auth is enabled, unauthenticated callers get HTTP 401 from `/me`.
 */
export async function isOidcConnectedSession(client: TrueForge = authClient): Promise<boolean> {
  const session = await client.auth.me();
  const isConnected = session.type === 'oidc-connected';
  cachedIsOidcConnected = isConnected;
  return isConnected;
}

export async function logout(client: TrueForge = authClient): Promise<void> {
  await client.auth.logout();
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
