/**
 * Session helpers: SDK `auth.me()` / `auth.logout()` only.
 * Login is not on the SDK (browser redirect to `/api/v1/auth/login`).
 */
import type { TrueForge, TrueForgeApi } from 'trueforge-sdk';
import { harnessClient, harnessProbeClient } from './harnessClient';

export type MeResponse = TrueForgeApi.MeResponse;

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
 * When OIDC is configured, unauthenticated callers get HTTP 401 from `/me`.
 */
export async function isOidcConnectedSession(client: TrueForge = harnessClient): Promise<boolean> {
  const session = await client.auth.me();
  const isConnected = session.type === 'oidc-connected';
  cachedIsOidcConnected = isConnected;
  return isConnected;
}

export async function logout(client: TrueForge = harnessClient): Promise<void> {
  await client.auth.logout();
}

/**
 * Pre-boot gate: GET `/me` without the 401→login redirect.
 * Any failure (e.g. OIDC configured but no session cookie yet) is treated as
 * unauthenticated so the app can render the welcome / "Let's Get Started" screen
 * rather than bouncing to login before the user asks for it.
 */
export async function probeSession(client: TrueForge = harnessProbeClient): Promise<SessionState> {
  try {
    await client.auth.me();
    return 'authenticated';
  } catch {
    return 'unauthenticated';
  }
}
