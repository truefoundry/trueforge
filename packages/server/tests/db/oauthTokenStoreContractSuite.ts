/**
 * Backend-agnostic behavioural contract for IOAuthTokenStore.
 * Runs under jest against a fresh store per test (see backend test files).
 *
 * The store's rows are FK'd to `mcp_server.id`, and pending authorizations expire on read, so
 * each backend supplies `seedResource` (create the FK parent) and `expirePending` (backdate a
 * pending row past its TTL).
 */
import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '@truefoundry/utils/core';

export interface OAuthTokenStoreHarness {
  store: IOAuthTokenStore;
  seedResource: (id: string) => Promise<void>;
  expirePending: (state: string) => Promise<void>;
}

const RESOURCE_ID = 'mcp-server-1';

function token(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    scope: 'read write',
    ...overrides,
  };
}

function pending(overrides: Partial<OAuthPendingAuthorization> = {}): OAuthPendingAuthorization {
  return {
    state: 'state-1',
    id: RESOURCE_ID,
    codeVerifier: 'verifier-1',
    redirectUrl: 'https://app.example.com/done',
    ...overrides,
  };
}

export function runOAuthTokenStoreContractSuite(getHarness: () => OAuthTokenStoreHarness): void {
  it('saveToken round-trips the token, including null fields', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    const saved = token({ refreshToken: null, scope: null });

    await h.store.saveToken({ id: RESOURCE_ID, token: saved });

    expect(await h.store.getToken({ id: RESOURCE_ID })).toEqual(saved);
  });

  it('saveToken replaces the token for an existing resource', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.saveToken({ id: RESOURCE_ID, token: token() });

    await h.store.saveToken({ id: RESOURCE_ID, token: token({ accessToken: 'access-2' }) });

    expect(await h.store.getToken({ id: RESOURCE_ID })).toEqual(token({ accessToken: 'access-2' }));
  });

  it('getToken is undefined before save and after delete', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    expect(await h.store.getToken({ id: RESOURCE_ID })).toBeUndefined();

    await h.store.saveToken({ id: RESOURCE_ID, token: token() });
    await h.store.deleteToken({ id: RESOURCE_ID });

    expect(await h.store.getToken({ id: RESOURCE_ID })).toBeUndefined();
  });

  it('savePendingAuthorization round-trips, including null fields', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    const saved = pending({ codeVerifier: null, redirectUrl: null });

    await h.store.savePendingAuthorization(saved);

    expect(await h.store.getPendingAuthorization({ state: 'state-1' })).toEqual(saved);
  });

  it('getPendingAuthorization is undefined for an unknown state', async () => {
    const h = getHarness();
    expect(await h.store.getPendingAuthorization({ state: 'unknown' })).toBeUndefined();
  });

  it('deletePendingAuthorization makes the state single-use', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.savePendingAuthorization(pending());

    await h.store.deletePendingAuthorization({ state: 'state-1' });

    expect(await h.store.getPendingAuthorization({ state: 'state-1' })).toBeUndefined();
  });

  it('getPendingAuthorization drops a row past its TTL', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.savePendingAuthorization(pending());

    await h.expirePending('state-1');

    expect(await h.store.getPendingAuthorization({ state: 'state-1' })).toBeUndefined();
  });
}
