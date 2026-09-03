import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import type { Configuration } from 'openid-client';
import winston from 'winston';
import { createAuthRouter } from '../../../src/apis/auth';
import { createAuthMiddleware } from '../../../src/auth/authenticator';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { disableOidcAuth, initOidc } from '../../../src/auth/oidc';
import { OidcAuthenticator } from '../../../src/auth/oidcAuthenticator';
import { StandaloneAuthenticator } from '../../../src/auth/standaloneAuthenticator';
import configuration from '../../../src/config';

jest.mock('../../../src/config', () => {
  const OIDC = {
    OIDC_ISSUER_URL: 'https://issuer.example.com/',
    OIDC_CLIENT_ID: 'harness-client',
    OIDC_CLIENT_SECRET: 'harness-secret',
    OIDC_USER_REFERENCE_CLAIM: 'sub',
    OIDC_USER_DISPLAY_NAME_CLAIM: 'name',
    OIDC_USER_ROLE_CLAIM: 'groups',
    OIDC_ADMIN_ROLE_VALUE: 'admin',
    OIDC_SCOPES: ['openid', 'profile', 'email', 'groups'],
    OIDC_ALLOWED_EMAILS: [] as string[],
  };
  const config = {
    STANDALONE: false as const,
    PUBLIC_BASE_URL: 'https://harness.example.com',
    NODE_ENV: 'development',
    OIDC,
    PORT: 8790,
  };
  return {
    __esModule: true,
    default: config,
    getPublicBaseUrl: (value = config) => {
      if (value.STANDALONE && value.NODE_ENV !== 'development') {
        return `http://localhost:${String(value.PORT)}`;
      }
      if (value.PUBLIC_BASE_URL === '') {
        throw new Error('PUBLIC_BASE_URL is required for OIDC callbacks but was empty');
      }
      return value.PUBLIC_BASE_URL;
    },
  };
});

if (configuration.STANDALONE || !configuration.OIDC) {
  throw new Error('OIDC test configuration is missing');
}

const ISSUER = 'https://issuer.example.com';
const CLIENT_ID = 'harness-client';
const STATE_COOKIE = 'oauth_state';
const ID_TOKEN_COOKIE = 'id_token';
const configuredOidc = configuration.OIDC;
const logger = winston.createLogger({ silent: true });

const ACCESS_TOKEN = 'access-1';

function createTestAuthRouter(params: { oidcClient: Configuration | undefined }) {
  const authenticator = params.oidcClient ? new OidcAuthenticator() : new StandaloneAuthenticator();
  return createAuthRouter({
    oidcClient: params.oidcClient,
    logger,
    authMiddleware: createAuthMiddleware(authenticator),
  });
}

describe('auth router (no identity provider configured)', () => {
  beforeEach(() => {
    disableOidcAuth();
  });

  it('GET /auth/login redirects home — there is nothing to log into', async () => {
    const router = createTestAuthRouter({ oidcClient: undefined });

    const res = await router.request('/login', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET /auth/callback redirects home — there is nothing to complete', async () => {
    const router = createTestAuthRouter({ oidcClient: undefined });

    const res = await router.request('/callback?state=abc', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('POST /auth/logout is a no-op 204 — there is no real session to clear', async () => {
    const router = createTestAuthRouter({ oidcClient: undefined });

    const res = await router.request('/logout', { method: 'POST' });

    expect(res.status).toBe(204);
  });

  it('GET /auth/me returns the standalone identity when auth is disabled', async () => {
    const router = createTestAuthRouter({ oidcClient: undefined });

    const res = await router.request('/me');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      subject: STANDALONE_REQUEST_CONTEXT.subject,
      is_admin: STANDALONE_REQUEST_CONTEXT.is_admin,
    });
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  for (const entry of cookies) {
    const first = entry.split(';')[0];
    if (first?.startsWith(prefix)) {
      return first.slice(prefix.length);
    }
  }
  return undefined;
}

describe('auth router (auth enabled)', () => {
  const realFetch = globalThis.fetch;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let publicJwk: JWK;
  let oidcClient: Configuration;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-kid';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
  });

  beforeEach(async () => {
    stubOidcFetch();
    const client = await initOidc(configuredOidc);
    if (!client) {
      throw new Error('OIDC client was not initialized');
    }
    oidcClient = client;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function createIdToken(): Promise<string> {
    const digest = createHash('sha256').update(ACCESS_TOKEN).digest();
    return new SignJWT({
      email: 'alice@customer.com',
      at_hash: digest.subarray(0, digest.length / 2).toString('base64url'),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('48h')
      .sign(privateKey);
  }

  function stubOidcFetch(): void {
    const fetchStub: typeof fetch = async (input, init) => {
      const url = String(input);

      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          id_token_signing_alg_values_supported: ['RS256'],
          subject_types_supported: ['public'],
          authorization_response_iss_parameter_supported: true,
        });
      }

      if (url === `${ISSUER}/jwks`) {
        return json({ keys: [publicJwk] });
      }

      if (url === `${ISSUER}/token` && init?.method === 'POST') {
        return json({
          access_token: ACCESS_TOKEN,
          id_token: await createIdToken(),
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }

      return new Response(`unexpected url: ${url}`, { status: 404 });
    };
    globalThis.fetch = fetchStub;
  }

  it('GET /login redirects to the IdP and stores state', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request('/login?return_to=/sessions/abc123', {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    const authUrl = new URL(location);
    expect(authUrl.origin + authUrl.pathname).toBe(`${ISSUER}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://harness.example.com/api/v1/auth/callback');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'groups']),
    );
    expect(JSON.parse(authUrl.searchParams.get('claims') ?? '{}')).toEqual({
      id_token: { sub: { essential: true }, groups: { essential: true } },
    });
    expect(cookieValue(setCookies(res), STATE_COOKIE)).toBeTruthy();
  });

  it('GET /login requests roles claim without groups scope when OIDC_USER_ROLE_CLAIM=roles', async () => {
    const rolesOidcClient = await initOidc({
      ...configuredOidc,
      OIDC_USER_ROLE_CLAIM: 'roles',
      OIDC_SCOPES: ['openid', 'profile', 'email'],
    });
    if (!rolesOidcClient) {
      throw new Error('OIDC client was not initialized');
    }

    const res = await createTestAuthRouter({ oidcClient: rolesOidcClient }).request('/login', {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const authUrl = new URL(res.headers.get('location') ?? '');
    expect(authUrl.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
    expect(authUrl.searchParams.get('scope')?.split(' ')).not.toContain('groups');
    expect(JSON.parse(authUrl.searchParams.get('claims') ?? '{}')).toEqual({
      id_token: { sub: { essential: true }, roles: { essential: true } },
    });
  });

  // `iss` is forwarded verbatim: IdPs advertising it reject an exchange that drops it.
  it('GET /callback exchanges the code and sets id_token', async () => {
    const router = createTestAuthRouter({ oidcClient });
    const loginRes = await router.request('/login?return_to=/sessions/abc123', { redirect: 'manual' });
    const stateCookieRaw = cookieValue(setCookies(loginRes), STATE_COOKIE) ?? '';
    const authorizationUrl = new URL(loginRes.headers.get('location') ?? '');
    const state = authorizationUrl.searchParams.get('state') ?? '';

    const callbackRes = await router.request(`/callback?code=abc123&state=${state}&iss=${encodeURIComponent(ISSUER)}`, {
      redirect: 'manual',
      headers: { Cookie: `${STATE_COOKIE}=${stateCookieRaw}` },
    });

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('/sessions/abc123');
    const idTokenCookie = setCookies(callbackRes).find(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`));
    expect(idTokenCookie).toContain('Max-Age=86400');
  });

  it('GET /callback rejects emails outside OIDC_ALLOWED_EMAILS without setting a session', async () => {
    const restrictedClient = await initOidc({
      ...configuredOidc,
      OIDC_ALLOWED_EMAILS: ['*@company.com'],
    });
    if (!restrictedClient) {
      throw new Error('OIDC client was not initialized');
    }

    const router = createTestAuthRouter({ oidcClient: restrictedClient });
    const loginRes = await router.request('/login', { redirect: 'manual' });
    const stateCookieRaw = cookieValue(setCookies(loginRes), STATE_COOKIE) ?? '';
    const authorizationUrl = new URL(loginRes.headers.get('location') ?? '');
    const state = authorizationUrl.searchParams.get('state') ?? '';
    expect(JSON.parse(authorizationUrl.searchParams.get('claims') ?? '{}')).toEqual({
      id_token: {
        sub: { essential: true },
        groups: { essential: true },
        email: { essential: true },
      },
    });

    const callbackRes = await router.request(`/callback?code=abc123&state=${state}&iss=${encodeURIComponent(ISSUER)}`, {
      redirect: 'manual',
      headers: { Cookie: `${STATE_COOKIE}=${stateCookieRaw}` },
    });

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('/?error=login_failed');
    expect(setCookies(callbackRes).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`))).toBe(false);
  });

  it('GET /callback redirects home with error when the IdP returns an error', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request(
      '/callback?state=any&error=access_denied&error_description=user%20cancelled',
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=user%20cancelled');
  });

  it('GET /callback uses login_failed when the IdP error has no description', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request('/callback?state=any&error=access_denied', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
  });

  it('GET /callback uses login_failed when the IdP error description is blank', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request(
      '/callback?state=any&error=access_denied&error_description=%20%20',
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
  });

  it('GET /callback ignores a crafted error_description when the IdP did not return an error', async () => {
    // No `error` code → this is our own validation failure, so the attacker-supplied
    // description must not be reflected; the reason stays generic.
    const crafted = 'Your%20account%20is%20compromised%2C%20call%201-800-EVIL';
    const res = await createTestAuthRouter({ oidcClient }).request(`/callback?state=any&error_description=${crafted}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
  });

  it('GET /callback redirects home with error when state mismatches', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request('/callback?code=abc&state=wrong', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
  });

  it('GET /callback replays home when already authenticated and the state cookie is spent', async () => {
    const token = await createIdToken();
    const res = await createTestAuthRouter({ oidcClient }).request('/callback?code=abc&state=spent', {
      redirect: 'manual',
      headers: { Cookie: `${ID_TOKEN_COOKIE}=${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET /callback clears a leftover cookie outside the allowlist without revealing why', async () => {
    // Rollout case: allowlist enabled while browsers still hold pre-allowlist id_tokens.
    // Failure stays generic (`login_failed`) so allowlist membership is not disclosed.
    const restrictedClient = await initOidc({
      ...configuredOidc,
      OIDC_ALLOWED_EMAILS: ['*@company.com'],
    });
    if (!restrictedClient) {
      throw new Error('OIDC client was not initialized');
    }

    const token = await createIdToken();
    const res = await createTestAuthRouter({ oidcClient: restrictedClient }).request('/callback?code=abc&state=spent', {
      redirect: 'manual',
      headers: { Cookie: `${ID_TOKEN_COOKIE}=${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
    expect(
      setCookies(res).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`) && cookie.includes('Max-Age=0')),
    ).toBe(true);
  });

  it('GET /callback replays home when already authenticated even if the IdP returned an error', async () => {
    const token = await createIdToken();
    const res = await createTestAuthRouter({ oidcClient }).request(
      '/callback?state=any&error=access_denied&error_description=user%20cancelled',
      {
        redirect: 'manual',
        headers: { Cookie: `${ID_TOKEN_COOKIE}=${token}` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET /callback keeps login_failed when exchange fails and the leftover cookie is blocked', async () => {
    const restrictedClient = await initOidc({
      ...configuredOidc,
      OIDC_ALLOWED_EMAILS: ['*@company.com'],
    });
    if (!restrictedClient) {
      throw new Error('OIDC client was not initialized');
    }

    const token = await createIdToken();
    const router = createTestAuthRouter({ oidcClient: restrictedClient });
    const loginRes = await router.request('/login?return_to=/sessions/abc123', { redirect: 'manual' });
    const stateCookieRaw = cookieValue(setCookies(loginRes), STATE_COOKIE) ?? '';
    const authorizationUrl = new URL(loginRes.headers.get('location') ?? '');
    const state = authorizationUrl.searchParams.get('state') ?? '';

    const res = await router.request(`/callback?code=abc&state=${state}&iss=${encodeURIComponent(ISSUER)}`, {
      redirect: 'manual',
      headers: { Cookie: `${STATE_COOKIE}=${stateCookieRaw}; ${ID_TOKEN_COOKIE}=${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=login_failed');
    expect(
      setCookies(res).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`) && cookie.includes('Max-Age=0')),
    ).toBe(true);
  });

  it('GET /callback keeps the existing session when code exchange fails', async () => {
    const token = await createIdToken();
    const router = createTestAuthRouter({ oidcClient });
    const loginRes = await router.request('/login?return_to=/sessions/abc123', { redirect: 'manual' });
    const stateCookieRaw = cookieValue(setCookies(loginRes), STATE_COOKIE) ?? '';
    const authorizationUrl = new URL(loginRes.headers.get('location') ?? '');
    const state = authorizationUrl.searchParams.get('state') ?? '';

    const fetchStub = globalThis.fetch;
    const failingFetch: typeof fetch = async (input, init) => {
      if (String(input) === `${ISSUER}/token` && init?.method === 'POST') {
        return new Response('invalid_grant', { status: 400 });
      }
      return fetchStub(input, init);
    };
    globalThis.fetch = failingFetch;

    const res = await router.request(`/callback?code=abc&state=${state}&iss=${encodeURIComponent(ISSUER)}`, {
      redirect: 'manual',
      headers: { Cookie: `${STATE_COOKIE}=${stateCookieRaw}; ${ID_TOKEN_COOKIE}=${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/sessions/abc123');
  });

  it('POST /logout clears id_token even when no cookie is present', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request('/logout', {
      method: 'POST',
    });

    expect(res.status).toBe(204);
    expect(
      setCookies(res).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`) && cookie.includes('Max-Age=0')),
    ).toBe(true);
  });

  it('GET /me returns 401 when the id_token cookie is missing', async () => {
    const res = await createTestAuthRouter({ oidcClient }).request('/me');
    expect(res.status).toBe(401);
  });

  it('GET /me returns RequestContext identity when authenticated', async () => {
    const token = await createIdToken();
    const res = await createTestAuthRouter({ oidcClient }).request('/me', {
      headers: { Cookie: `${ID_TOKEN_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenant_id: 'default',
      subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
      is_admin: false,
    });
  });
});
