/**
 * Session helpers: SDK `auth.me()` / `auth.logout()` only.
 * Login is not on the SDK (browser redirect to `/api/v1/auth/login`).
 */
import type { TrueForgeApi as Harness, TrueForge } from 'trueforge';
import { harnessClient } from './harnessClient';

export type MeResponse = Harness.MeResponse;

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
