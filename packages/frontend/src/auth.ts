/** Session helpers for the SPA boot gate. */

export interface AuthIdentity {
  user_ref: string;
  role: 'admin' | 'user';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function fetchAuthConfig(): Promise<{ oidc_enabled: boolean }> {
  const response = await fetch('/api/v1/auth/config', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to load auth config (${String(response.status)})`);
  }
  const body: unknown = await response.json();
  if (!isObject(body) || typeof body.oidc_enabled !== 'boolean') {
    throw new Error('Invalid auth config response');
  }
  return { oidc_enabled: body.oidc_enabled };
}

/**
 * Returns the current identity, or `undefined` when the server responds 401.
 * Throws on unexpected failures (network / 5xx).
 */
export async function fetchCurrentIdentity(): Promise<AuthIdentity | undefined> {
  const response = await fetch('/api/v1/auth/me', {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Failed to load identity (${String(response.status)})`);
  }
  const body: unknown = await response.json();
  if (!isObject(body)) {
    throw new Error('Invalid identity response');
  }
  const userRef = body.user_ref;
  const role = body.role;
  if (typeof userRef !== 'string') {
    throw new Error('Invalid identity response');
  }
  if (role !== 'admin' && role !== 'user') {
    throw new Error('Invalid identity response');
  }
  return { user_ref: userRef, role };
}

/** Clears the session cookie. Caller should reload so the boot gate shows login. */
export async function logout(): Promise<void> {
  const response = await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Logout failed (${String(response.status)})`);
  }
}
