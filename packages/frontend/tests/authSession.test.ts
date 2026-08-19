import type { TrueForge } from '@truefoundry/trueforge-sdk';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCachedIsOidcConnectedSession,
  isOidcConnectedSession,
  logout,
  probeSession,
  resetOidcSessionCacheForTests,
} from '../src/authSession';

function createClient(params: { type?: 'default' | 'oidc-connected'; meError?: Error }): TrueForge {
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

  it('POSTs /api/v1/auth/logout with credentials and succeeds on 204', async () => {
    const calls: { url: string; method: string | undefined; credentials: RequestCredentials | undefined }[] = [];
    await logout(async (input, init) => {
      calls.push({ url: String(input), method: init?.method, credentials: init?.credentials });
      return new Response(null, { status: 204 });
    });
    assert.deepEqual(calls, [{ url: '/api/v1/auth/logout', method: 'POST', credentials: 'include' }]);
  });

  it('throws when logout is not 2xx', async () => {
    await assert.rejects(() => logout(async () => new Response(null, { status: 500 })), /Logout failed \(500\)/);
  });

  it('probeSession reports authenticated when me() resolves', async () => {
    assert.equal(await probeSession(createClient({ type: 'default' })), 'authenticated');
    assert.equal(await probeSession(createClient({ type: 'oidc-connected' })), 'authenticated');
  });

  it('probeSession reports unauthenticated when me() throws', async () => {
    assert.equal(await probeSession(createClient({ meError: new Error('401') })), 'unauthenticated');
  });
});
