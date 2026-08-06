import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { createRequireAuthMiddleware, verifyIdToken } from '../../../src/auth/middleware';
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
const AUDIENCE = 'harness-client';
const configuredOidc = configuration.OIDC;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createApp(params: { oidcClient: Configuration | undefined }) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    throw error;
  });
  // Public route registered before the gate — middleware must not touch it.
  app.get('/api/v1/auth/login', c => c.json({ public: true }));
  app.use('/api/v1/*', createRequireAuthMiddleware({ oidcClient: params.oidcClient }));
  app.get('/api/v1/models', c => c.json({ ok: true }));
  return app;
}

describe('createRequireAuthMiddleware', () => {
  it('is a no-op when oidcClient is undefined', async () => {
    const app = createApp({ oidcClient: undefined });
    const res = await app.request('/api/v1/models');
    expect(res.status).toBe(200);
  });

  describe('when OIDC is configured', () => {
    const realFetch = globalThis.fetch;
    let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
    let oidcClient: Configuration;

    beforeAll(async () => {
      const keyPair = await generateKeyPair('RS256');
      privateKey = keyPair.privateKey;
      const publicJwk = await exportJWK(keyPair.publicKey);
      publicJwk.kid = 'test-kid';
      publicJwk.alg = 'RS256';
      publicJwk.use = 'sig';

      const fetchStub: typeof fetch = async input => {
        const url = String(input);
        if (url === `${ISSUER}/.well-known/openid-configuration`) {
          return json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
            response_types_supported: ['code'],
            id_token_signing_alg_values_supported: ['RS256'],
            subject_types_supported: ['public'],
          });
        }
        if (url === `${ISSUER}/jwks`) {
          return json({ keys: [publicJwk] });
        }
        return new Response(`unexpected url: ${url}`, { status: 404 });
      };
      globalThis.fetch = fetchStub;

      const client = await initOidc(configuredOidc);
      if (!client) {
        throw new Error('OIDC client was not initialized');
      }
      oidcClient = client;
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
    });

    async function createIdToken(params?: { issuer?: string }): Promise<string> {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuer(params?.issuer ?? ISSUER)
        .setAudience(AUDIENCE)
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
    }

    it('returns 401 when the id_token cookie is missing', async () => {
      const res = await createApp({ oidcClient }).request('/api/v1/models');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token is invalid', async () => {
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: 'id_token=not-a-jwt' },
      });
      expect(res.status).toBe(401);
    });

    it('allows the request when the token verifies', async () => {
      const token = await createIdToken();
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('returns 401 when the token has the wrong issuer', async () => {
      const token = await createIdToken({ issuer: 'https://other.example.com' });
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
    });

    it('does not gate routes registered before the middleware', async () => {
      const res = await createApp({ oidcClient }).request('/api/v1/auth/login');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ public: true });
    });
  });
});

describe('verifyIdToken', () => {
  it('accepts a signature-valid token and rejects a bad issuer', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.alg = 'RS256';
    const jwks = createLocalJWKSet({ keys: [jwk] });

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifyIdToken({ token, jwks, issuer: ISSUER, audience: AUDIENCE })).resolves.toBeUndefined();
    await expect(
      verifyIdToken({ token, jwks, issuer: 'https://other.example.com', audience: AUDIENCE }),
    ).rejects.toThrow();
  });
});
