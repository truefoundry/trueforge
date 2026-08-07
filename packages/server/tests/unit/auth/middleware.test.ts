import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { authMiddleware, configureAuth } from '../../../src/auth/middleware';
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
  configureAuth(params.oidcClient);
  const app = new OpenAPIHono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    throw error;
  });

  app.get('/api/v1/auth/login', c => c.json({ public: true }));

  const models = new OpenAPIHono();
  models.use('*', authMiddleware);
  models.get('/', c => c.json({ ok: true, user: c.get('user') }));
  app.route('/api/v1/models', models);

  return app;
}

describe('authMiddleware', () => {
  it('sets default user when oidcClient is undefined', async () => {
    const res = await createApp({ oidcClient: undefined }).request('/api/v1/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user: { email: 'default', role: 'user' },
    });
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

      globalThis.fetch = async input => {
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

      const client = await initOidc(configuredOidc);
      if (!client) {
        throw new Error('OIDC client was not initialized');
      }
      oidcClient = client;
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
    });

    async function createIdToken(params?: { issuer?: string; email?: string }): Promise<string> {
      return new SignJWT({ email: params?.email ?? 'alice@example.com' })
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
      expect(await res.json()).toEqual({ error: { message: 'user_login_required' } });
    });

    it('returns 401 when the token is invalid', async () => {
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: 'id_token=not-a-jwt' },
      });
      expect(res.status).toBe(401);
    });

    it('sets user context when the token verifies', async () => {
      const token = await createIdToken({ email: 'bob@example.com' });
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { email: 'bob@example.com', role: 'user' },
      });
    });

    it('returns 401 when the token has the wrong issuer', async () => {
      const token = await createIdToken({ issuer: 'https://other.example.com' });
      const res = await createApp({ oidcClient }).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
    });

    it('does not gate public mounts', async () => {
      const res = await createApp({ oidcClient }).request('/api/v1/auth/login');
      expect(res.status).toBe(200);
    });
  });
});
