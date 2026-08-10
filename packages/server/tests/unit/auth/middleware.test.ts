import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { adminAuthMiddleware, authMiddleware } from '../../../src/auth/middleware';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import type { OIDCConfig } from '../../../src/config';

const ISSUER = 'https://issuer.example.com';
const AUDIENCE = 'harness-client';

const OIDC_CONFIG: OIDCConfig = {
  OIDC_ISSUER_URL: `${ISSUER}/`,
  OIDC_CLIENT_ID: AUDIENCE,
  OIDC_CLIENT_SECRET: 'harness-secret',
  OIDC_USER_REFERENCE_CLAIM: 'sub',
  OIDC_USER_ROLE_CLAIM: 'groups',
  OIDC_ADMIN_ROLE_VALUE: 'admin',
  OIDC_SCOPES: ['openid', 'profile', 'email', 'groups'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createApp() {
  const app = new OpenAPIHono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    throw error;
  });

  // Public mounts — no auth middleware (mirrors production allowlist shape).
  app.get('/healthz', c => c.json({ public: true }));
  app.get('/api/v1/auth/login', c => c.json({ public: true }));
  app.get('/api/v1/auth/callback', c => c.json({ public: true }));
  app.get('/api/v1/mcp-servers/oauth/callback', c => c.json({ public: true }));
  app.get('/api/v1/openapi', c => c.json({ public: true }));

  const models = new OpenAPIHono();
  models.use('*', authMiddleware);
  models.get('/', c => c.json({ ok: true, user: c.get('user_context') }));
  app.route('/api/v1/models', models);

  const settings = new OpenAPIHono();
  settings.use('*', adminAuthMiddleware);
  settings.get('/', c => c.json({ ok: true, user: c.get('user_context') }));
  app.route('/api/v1/settings', settings);

  return app;
}

describe('authMiddleware', () => {
  it('allows settings without admin role when auth is disabled', async () => {
    disableOidcAuth();
    const res = await createApp().request('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user: { userRef: 'trueforge-default', role: 'admin' },
    });
  });

  it('sets default user when auth is disabled', async () => {
    disableOidcAuth();
    const res = await createApp().request('/api/v1/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user: { userRef: 'trueforge-default', role: 'admin' },
    });
  });

  describe('when auth is enabled', () => {
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

      const client = await initOidc(OIDC_CONFIG);
      if (!client) {
        throw new Error('OIDC client was not initialized');
      }
      oidcClient = client;
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
      disableOidcAuth();
    });

    beforeEach(() => {
      enableOidcAuth({ client: oidcClient, oidcConfig: OIDC_CONFIG });
    });

    async function createIdToken(params?: {
      issuer?: string;
      audience?: string;
      sub?: string;
      groups?: string[];
      exp?: string | number;
    }): Promise<string> {
      return new SignJWT({ groups: params?.groups ?? [] })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuer(params?.issuer ?? ISSUER)
        .setAudience(params?.audience ?? AUDIENCE)
        .setSubject(params?.sub ?? 'user-1')
        .setIssuedAt()
        .setExpirationTime(params?.exp ?? '1h')
        .sign(privateKey);
    }

    it('returns 401 when the id_token cookie and Bearer token are missing', async () => {
      const res = await createApp().request('/api/v1/models');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token is invalid', async () => {
      const res = await createApp().request('/api/v1/models', {
        headers: { Cookie: 'id_token=not-a-jwt' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the Bearer token is invalid', async () => {
      const res = await createApp().request('/api/v1/models', {
        headers: { Authorization: 'Bearer not-a-jwt' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token has the wrong issuer', async () => {
      const token = await createIdToken({ issuer: 'https://other.example.com' });
      const res = await createApp().request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token has the wrong audience', async () => {
      const token = await createIdToken({ audience: 'other-client' });
      const res = await createApp().request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token is expired', async () => {
      const token = await createIdToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      const res = await createApp().request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('sets user context from claims (reference claim + role)', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp().request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'alice', role: 'admin' },
      });
    });

    it('sets user context from Authorization Bearer ID token', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp().request('/api/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'alice', role: 'admin' },
      });
    });

    it('prefers Bearer over cookie when both are present', async () => {
      const cookieToken = await createIdToken({ sub: 'cookie-user', groups: [] });
      const bearerToken = await createIdToken({ sub: 'bearer-user', groups: ['admin'] });
      const res = await createApp().request('/api/v1/models', {
        headers: {
          Cookie: `id_token=${cookieToken}`,
          Authorization: `Bearer ${bearerToken}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'bearer-user', role: 'admin' },
      });
    });

    it('ignores non-Bearer Authorization and falls back to cookie', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp().request('/api/v1/models', {
        headers: {
          Authorization: `Basic ${token}`,
          Cookie: `id_token=${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'alice', role: 'admin' },
      });
    });

    it('allows settings when the caller has admin role', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp().request('/api/v1/settings', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'alice', role: 'admin' },
      });
    });

    it('allows settings with Bearer when the caller has admin role', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp().request('/api/v1/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: { userRef: 'alice', role: 'admin' },
      });
    });

    it('returns 403 on settings when the caller is not admin', async () => {
      const token = await createIdToken({ sub: 'bob', groups: ['everyone'] });
      const res = await createApp().request('/api/v1/settings', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { message: 'Admin access required' } });
    });

    it.each([
      '/healthz',
      '/api/v1/auth/login',
      '/api/v1/auth/callback',
      '/api/v1/mcp-servers/oauth/callback',
      '/api/v1/openapi',
    ])('does not gate public mount %s', async path => {
      const res = await createApp().request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ public: true });
    });
  });
});
