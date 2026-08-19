/**
 * Backend-agnostic behavioural contract for IOAuthTokenStore.
 * Runs under jest against a fresh store per test (see backend test files).
 *
 * The store's rows are FK'd to `mcp_server.id`, and pending authorizations expire on read, so
 * each backend supplies `seedResource` (create the FK parent) and `expirePending` (backdate a
 * pending row past its TTL). Tokens are scoped per (resource id, userRef).
 */
import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '../../src/mcp/auth/types';

export interface OAuthTokenStoreHarness {
  store: IOAuthTokenStore;
  seedResource: (id: string) => Promise<void>;
  expirePending: (state: string) => Promise<void>;
}

const RESOURCE_ID = 'mcp-server-1';
const OTHER_RESOURCE_ID = 'mcp-server-2';
const USER_REF = 'user-a';
const OTHER_USER_REF = 'user-b';

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
    userRef: USER_REF,
    mcpServerUrl: 'https://mcp.example.com/sse',
    codeVerifier: 'verifier-1',
    returnTo: '/done',
    ...overrides,
  };
}

export function runOAuthTokenStoreContractSuite(getHarness: () => OAuthTokenStoreHarness): void {
  it('saveToken round-trips the token, including null fields', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    const saved = token({ refreshToken: null, scope: null });

    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: saved });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toEqual(saved);
  });

  it('saveToken replaces the token for an existing resource+user', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: token() });

    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: token({ accessToken: 'access-2' }) });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toEqual(token({ accessToken: 'access-2' }));
  });

  it('getToken is undefined before save and after delete', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toBeUndefined();

    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: token() });
    await h.store.deleteToken({ id: RESOURCE_ID, userRef: USER_REF });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toBeUndefined();
  });

  it('getTokens batches only the ids that have a stored token for the user', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.seedResource(OTHER_RESOURCE_ID);
    const first = token();
    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: first });
    await h.store.saveToken({
      id: OTHER_RESOURCE_ID,
      userRef: OTHER_USER_REF,
      token: token({ accessToken: 'other-user' }),
    });

    const found = await h.store.getTokens({
      ids: [RESOURCE_ID, OTHER_RESOURCE_ID, 'mcp-server-absent'],
      userRef: USER_REF,
    });

    expect(found).toEqual(new Map([[RESOURCE_ID, first]]));
  });

  it('getTokens returns an empty map for no ids', async () => {
    const h = getHarness();
    expect(await h.store.getTokens({ ids: [], userRef: USER_REF })).toEqual(new Map());
  });

  it('tokens are scoped per resource', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.seedResource(OTHER_RESOURCE_ID);
    const other = token({ accessToken: 'access-other' });
    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: token() });
    await h.store.saveToken({ id: OTHER_RESOURCE_ID, userRef: USER_REF, token: other });

    await h.store.deleteToken({ id: RESOURCE_ID, userRef: USER_REF });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toBeUndefined();
    expect(await h.store.getToken({ id: OTHER_RESOURCE_ID, userRef: USER_REF })).toEqual(other);
  });

  it('tokens are scoped per user on the same resource', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    const forA = token({ accessToken: 'access-a' });
    const forB = token({ accessToken: 'access-b' });
    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: forA });
    await h.store.saveToken({ id: RESOURCE_ID, userRef: OTHER_USER_REF, token: forB });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toEqual(forA);
    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: OTHER_USER_REF })).toEqual(forB);

    await h.store.deleteToken({ id: RESOURCE_ID, userRef: USER_REF });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toBeUndefined();
    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: OTHER_USER_REF })).toEqual(forB);
  });

  it('deleteTokensForServer removes every user token for that resource only', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.seedResource(OTHER_RESOURCE_ID);
    const other = token({ accessToken: 'access-other' });
    await h.store.saveToken({ id: RESOURCE_ID, userRef: USER_REF, token: token({ accessToken: 'access-a' }) });
    await h.store.saveToken({ id: RESOURCE_ID, userRef: OTHER_USER_REF, token: token({ accessToken: 'access-b' }) });
    await h.store.saveToken({ id: OTHER_RESOURCE_ID, userRef: USER_REF, token: other });

    await h.store.deleteTokensForServer({ id: RESOURCE_ID });

    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: USER_REF })).toBeUndefined();
    expect(await h.store.getToken({ id: RESOURCE_ID, userRef: OTHER_USER_REF })).toBeUndefined();
    expect(await h.store.getToken({ id: OTHER_RESOURCE_ID, userRef: USER_REF })).toEqual(other);
  });

  it('savePendingAuthorization + consumePendingAuthorization round-trips, including null fields', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    const saved = pending({ codeVerifier: null, returnTo: null });

    await h.store.savePendingAuthorization(saved);

    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toEqual(saved);
  });

  it('consumePendingAuthorization is undefined for an unknown state', async () => {
    const h = getHarness();
    expect(await h.store.consumePendingAuthorization({ state: 'unknown' })).toBeUndefined();
  });

  it('consumePendingAuthorization makes the state single-use', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.savePendingAuthorization(pending());

    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toEqual(pending());
    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toBeUndefined();
  });

  it('pending authorizations are keyed by state, not by resource', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.seedResource(OTHER_RESOURCE_ID);
    const other = pending({
      state: 'state-2',
      id: OTHER_RESOURCE_ID,
      userRef: OTHER_USER_REF,
      codeVerifier: 'verifier-2',
    });
    await h.store.savePendingAuthorization(pending());
    await h.store.savePendingAuthorization(other);

    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toEqual(pending());
    expect(await h.store.consumePendingAuthorization({ state: 'state-2' })).toEqual(other);
  });

  it('deletePendingAuthorizationsForServer removes every pending row for that resource only', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.seedResource(OTHER_RESOURCE_ID);
    const otherUser = pending({
      state: 'state-other-user',
      userRef: OTHER_USER_REF,
      codeVerifier: 'verifier-other-user',
    });
    const otherServer = pending({
      state: 'state-other-server',
      id: OTHER_RESOURCE_ID,
      userRef: USER_REF,
      codeVerifier: 'verifier-other-server',
    });
    await h.store.savePendingAuthorization(pending());
    await h.store.savePendingAuthorization(otherUser);
    await h.store.savePendingAuthorization(otherServer);

    await h.store.deletePendingAuthorizationsForServer({ id: RESOURCE_ID });

    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toBeUndefined();
    expect(await h.store.consumePendingAuthorization({ state: 'state-other-user' })).toBeUndefined();
    expect(await h.store.consumePendingAuthorization({ state: 'state-other-server' })).toEqual(otherServer);
  });

  it('consumePendingAuthorization drops a row past its TTL', async () => {
    const h = getHarness();
    await h.seedResource(RESOURCE_ID);
    await h.store.savePendingAuthorization(pending());

    await h.expirePending('state-1');

    expect(await h.store.consumePendingAuthorization({ state: 'state-1' })).toBeUndefined();
  });
}
