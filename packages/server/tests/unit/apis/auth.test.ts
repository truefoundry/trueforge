import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import type { Configuration } from 'openid-client';
import winston from 'winston';
import { createAuthRouter } from '../../../src/apis/auth';
import { initOidc } from '../../../src/auth/oidc';
import configuration from '../../../src/config';

jest.mock('../../../src/config', () => {
  const OIDC = {
    OIDC_ISSUER_URL: 'https://issuer.example.com/',
    OIDC_CLIENT_ID: 'harness-client',
    OIDC_CLIENT_SECRET: 'harness-secret',
    OIDC_USER_REFERENCE_CLAIM: 'sub',
    OIDC_USER_ROLE_CLAIM: 'groups',
    OIDC_ADMIN_ROLE_VALUE: 'admin',
  };
  return {
    __esModule: true,
    default: {
      STANDALONE: false,
      PUBLIC_BASE_URL: 'https://harness.example.com',
      OIDC,
      PORT: 8790,
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

describe('auth router (no identity provider configured)', () => {
  it('GET /login redirects home — there is nothing to log into', async () => {
    const router = createAuthRouter({ oidcClient: undefined, logger });

    const res = await router.request('/login', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET /callback redirects home — there is nothing to complete', async () => {
    const router = createAuthRouter({ oidcClient: undefined, logger });

    const res = await router.request('/callback?state=abc', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('POST /logout is a no-op 204 — there is no real session to clear', async () => {
    const router = createAuthRouter({ oidcClient: undefined, logger });

    const res = await router.request('/logout', { method: 'POST' });

    expect(res.status).toBe(204);
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

describe('auth router (OIDC configured)', () => {
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
    const res = await createAuthRouter({ oidcClient, logger }).request('/login?return_to=/sessions/abc123', {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    const authUrl = new URL(location);
    expect(authUrl.origin + authUrl.pathname).toBe(`${ISSUER}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://harness.example.com/api/v1/auth/callback');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(cookieValue(setCookies(res), STATE_COOKIE)).toBeTruthy();
  });

  // `iss` is forwarded verbatim: IdPs advertising it reject an exchange that drops it.
  it('GET /callback exchanges the code and sets id_token', async () => {
    const router = createAuthRouter({ oidcClient, logger });
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

  it('POST /logout clears id_token even when no cookie is present', async () => {
    const res = await createAuthRouter({ oidcClient, logger }).request('/logout', {
      method: 'POST',
    });

    expect(res.status).toBe(204);
    expect(
      setCookies(res).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`) && cookie.includes('Max-Age=0')),
    ).toBe(true);
  });
});
