import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TrueForge } from 'trueforge';
import {
  getCachedIsOidcConnectedSession,
  isOidcConnectedSession,
  logout,
  resetOidcSessionCacheForTests,
} from '../src/authSession';

function createClient(params: {
  type?: 'default' | 'oidc-connected';
  onLogout?: () => void;
  meError?: Error;
}): TrueForge {
  return {
    auth: {
      me: async () => {
        if (params.meError != null) throw params.meError;
        return {
          type: params.type ?? 'default',
          email: 'user@example.com',
          role: 'user',
        };
      },
      logout: async () => {
        params.onLogout?.();
      },
    },
  } as unknown as TrueForge;
}

describe('authSession', () => {
  it('detects oidc-connected sessions via auth.me and caches the result', async () => {
    resetOidcSessionCacheForTests();
    assert.equal(getCachedIsOidcConnectedSession(), undefined);
    assert.equal(await isOidcConnectedSession(createClient({ type: 'oidc-connected' })), true);
    assert.equal(getCachedIsOidcConnectedSession(), true);
    assert.equal(await isOidcConnectedSession(createClient({ type: 'default' })), false);
    assert.equal(getCachedIsOidcConnectedSession(), false);
  });

  it('does not clear the cache when auth.me fails', async () => {
    resetOidcSessionCacheForTests();
    assert.equal(await isOidcConnectedSession(createClient({ type: 'oidc-connected' })), true);
    await assert.rejects(() => isOidcConnectedSession(createClient({ meError: new Error('network') })), /network/);
    assert.equal(getCachedIsOidcConnectedSession(), true);
  });

  it('delegates logout to auth.logout', async () => {
    let called = false;
    await logout(
      createClient({
        onLogout: () => {
          called = true;
        },
      }),
    );
    assert.equal(called, true);
  });
});
