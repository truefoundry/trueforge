import * as jose from 'jose';
import { createHash } from 'node:crypto';
import { createAuthRouter } from '../../../src/apis/auth';
import { initOidc, resetOidcForTests } from '../../../src/auth/oidc';

const ISSUER = 'https://issuer.example.com';
const CLIENT_ID = 'harness-client';
const STATE_COOKIE = 'oauth_state';
const ID_TOKEN_COOKIE = 'id_token';

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
    isOidcConfigured: () => true,
  };
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
  let privateKey: jose.CryptoKey;
  let publicJwk: jose.JWK;

  beforeAll(async () => {
    const pair = await jose.generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = await jose.exportJWK(pair.publicKey);
    publicJwk.kid = 'test-kid';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
  });

  beforeEach(async () => {
    resetOidcForTests();
    stubOidcFetch();
    await initOidc();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetOidcForTests();
  });

  function accessTokenHash(accessToken: string): string {
    const digest = createHash('sha256').update(accessToken).digest();
    return Buffer.from(digest.subarray(0, digest.length / 2)).toString('base64url');
  }

  async function signIdToken(claims: {
    email: string;
    expOffsetSeconds?: number;
    accessToken?: string;
  }): Promise<string> {
    const expOffsetSeconds = claims.expOffsetSeconds ?? 3600;
    const payload: Record<string, string> = { email: claims.email };
    if (claims.accessToken !== undefined) {
      payload['at_hash'] = accessTokenHash(claims.accessToken);
    }
    return new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(`${String(expOffsetSeconds)}s`)
      .sign(privateKey);
  }

  function stubOidcFetch(): void {
    const fetchStub: typeof fetch = async (input, init) => {
      const url = String(input);

      if (url === `${ISSUER}/.well-known/openid-configuration?client_id=${CLIENT_ID}`) {
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
        });
      }

      if (url === `${ISSUER}/jwks`) {
        return json({ keys: [publicJwk] });
      }

      if (url === `${ISSUER}/token` && init?.method === 'POST') {
        const accessToken = 'access-1';
        const idToken = await signIdToken({
          email: 'alice@customer.com',
          accessToken,
        });
        return json({
          access_token: accessToken,
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }

      return new Response(`unexpected url: ${url}`, { status: 404 });
    };
    globalThis.fetch = fetchStub;
  }

  it('GET /config reports oidc enabled', async () => {
    const res = await createAuthRouter().request('/config');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ oidc_enabled: true });
  });

  it('GET /login redirects to the IdP and stores state', async () => {
    const res = await createAuthRouter().request('/login?return_to=/sessions/abc123', { redirect: 'manual' });

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    const authUrl = new URL(location);
    expect(authUrl.origin + authUrl.pathname).toBe(`${ISSUER}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://harness.example.com/api/v1/auth/callback');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(cookieValue(setCookies(res), STATE_COOKIE)).toBeTruthy();
  });

  it('GET /callback exchanges the code and sets id_token', async () => {
    const router = createAuthRouter();
    const loginRes = await router.request('/login?return_to=/sessions/abc123', { redirect: 'manual' });
    const stateCookieRaw = cookieValue(setCookies(loginRes), STATE_COOKIE) ?? '';
    const authorizationUrl = new URL(loginRes.headers.get('location') ?? '');
    const state = authorizationUrl.searchParams.get('state') ?? '';

    const callbackRes = await router.request(`/callback?code=abc123&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `${STATE_COOKIE}=${stateCookieRaw}` },
    });

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('/sessions/abc123');
    expect(cookieValue(setCookies(callbackRes), ID_TOKEN_COOKIE)).toBeTruthy();
  });

  it('GET /me returns the email as user_ref and a default user role', async () => {
    const idToken = await signIdToken({ email: 'alice@customer.com' });

    const res = await createAuthRouter().request('/me', {
      headers: { Cookie: `${ID_TOKEN_COOKIE}=${idToken}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user_ref: 'alice@customer.com',
      role: 'user',
    });
  });

  it('GET /me returns 401 without a cookie', async () => {
    const res = await createAuthRouter().request('/me');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { message: 'Not authenticated' } });
  });

  it('POST /logout clears id_token', async () => {
    const res = await createAuthRouter().request('/logout', {
      method: 'POST',
    });

    expect(res.status).toBe(204);
    expect(
      setCookies(res).some(cookie => cookie.startsWith(`${ID_TOKEN_COOKIE}=`) && cookie.includes('Max-Age=0')),
    ).toBe(true);
  });
});
