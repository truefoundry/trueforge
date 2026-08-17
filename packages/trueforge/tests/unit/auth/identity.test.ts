import { isAdmin, LOCAL_USER_CONTEXT, type UserContext } from '../../../src/auth/identity';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import type { OIDCConfig } from '../../../src/config';

const OIDC_CONFIG: OIDCConfig = {
  OIDC_ISSUER_URL: 'https://issuer.example.com/',
  OIDC_CLIENT_ID: 'harness-client',
  OIDC_CLIENT_SECRET: 'harness-secret',
  OIDC_USER_REFERENCE_CLAIM: 'sub',
  OIDC_USER_ROLE_CLAIM: 'groups',
  OIDC_ADMIN_ROLE_VALUE: 'admin',
  OIDC_SCOPES: ['openid', 'profile', 'email', 'groups'],
};

function user(role: UserContext['role']): UserContext {
  return { userRef: 'alice', role };
}

describe('isAdmin', () => {
  afterEach(() => {
    disableOidcAuth();
  });

  it('is always true without OIDC (standalone)', () => {
    disableOidcAuth();
    expect(isAdmin(user('user'))).toBe(true);
    expect(isAdmin(LOCAL_USER_CONTEXT)).toBe(true);
  });

  it('checks role when auth is enabled', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          issuer: 'https://issuer.example.com',
          jwks_uri: 'https://issuer.example.com/jwks',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );

    const client = await initOidc(OIDC_CONFIG);
    if (!client) {
      throw new Error('OIDC client was not initialized');
    }
    enableOidcAuth({ client, oidcConfig: OIDC_CONFIG });

    expect(isAdmin(user('admin'))).toBe(true);
    expect(isAdmin(user('user'))).toBe(false);
  });
});
