import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import type { Authenticator } from '../../../src/auth/authenticator';
import { createAdminAuthMiddleware, createAuthMiddleware } from '../../../src/auth/authenticator';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import { OidcAuthenticator } from '../../../src/auth/oidcAuthenticator';
import { StandaloneAuthenticator } from '../../../src/auth/standaloneAuthenticator';
import type { OIDCConfig } from '../../../src/config';

const ISSUER = 'https://issuer.example.com';
const AUDIENCE = 'harness-client';

const OIDC_CONFIG: OIDCConfig = {
  OIDC_ISSUER_URL: `${ISSUER}/`,
  OIDC_CLIENT_ID: AUDIENCE,
  OIDC_CLIENT_SECRET: 'harness-secret',
  OIDC_USER_REFERENCE_CLAIM: 'sub',
  OIDC_USER_DISPLAY_NAME_CLAIM: 'name',
  OIDC_USER_ROLE_CLAIM: 'groups',
  OIDC_ADMIN_ROLE_VALUE: 'admin',
  OIDC_SCOPES: ['openid', 'profile', 'email', 'groups'],
  OIDC_ALLOWED_EMAILS: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createApp(authenticator: Authenticator) {
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
  models.use('*', createAuthMiddleware(authenticator));
  models.get('/', c => c.json({ ok: true, user: c.get('request_context') }));
  app.route('/api/v1/models', models);

  const settings = new OpenAPIHono();
  settings.use('*', createAdminAuthMiddleware(authenticator));
  settings.get('/', c => c.json({ ok: true, user: c.get('request_context') }));
  app.route('/api/v1/settings', settings);

  return app;
}

describe('createAuthMiddleware / createAdminAuthMiddleware', () => {
  it('allows settings for standalone authenticator (always admin)', async () => {
    const res = await createApp(new StandaloneAuthenticator()).request('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user: STANDALONE_REQUEST_CONTEXT,
    });
  });

  it('sets standalone request context when using StandaloneAuthenticator', async () => {
    const res = await createApp(new StandaloneAuthenticator()).request('/api/v1/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user: STANDALONE_REQUEST_CONTEXT,
    });
  });

  describe('with OidcAuthenticator', () => {
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
      email?: string;
      name?: string;
      exp?: string | number;
    }): Promise<string> {
      const claims: Record<string, unknown> = { groups: params?.groups ?? [] };
      if (params?.email !== undefined) {
        claims['email'] = params.email;
      }
      if (params?.name !== undefined) {
        claims['name'] = params.name;
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuer(params?.issuer ?? ISSUER)
        .setAudience(params?.audience ?? AUDIENCE)
        .setSubject(params?.sub ?? 'user-1')
        .setIssuedAt()
        .setExpirationTime(params?.exp ?? '1h')
        .sign(privateKey);
    }

    function oidcRequestContext(params: {
      subjectId: string;
      isAdmin: boolean;
      authorization: string;
      displayName?: string;
    }) {
      return {
        tenant_id: 'default',
        subject: {
          id: params.subjectId,
          type: 'user' as const,
          display_name: params.displayName ?? params.subjectId,
        },
        is_admin: params.isAdmin,
        user_credential: { authorization: params.authorization },
      };
    }

    it('returns 401 when the id_token cookie and Bearer token are missing', async () => {
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token is invalid', async () => {
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: 'id_token=not-a-jwt' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the Bearer token is invalid', async () => {
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Authorization: 'Bearer not-a-jwt' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token has the wrong issuer', async () => {
      const token = await createIdToken({ issuer: 'https://other.example.com' });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token has the wrong audience', async () => {
      const token = await createIdToken({ audience: 'other-client' });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('returns 401 when the token is expired', async () => {
      const token = await createIdToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('sets request context from claims (reference claim + role)', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it('sets request context from Authorization Bearer ID token', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it('prefers Bearer over cookie when both are present', async () => {
      const cookieToken = await createIdToken({ sub: 'cookie-user', groups: [] });
      const bearerToken = await createIdToken({ sub: 'bearer-user', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: {
          Cookie: `id_token=${cookieToken}`,
          Authorization: `Bearer ${bearerToken}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'bearer-user',
          isAdmin: true,
          authorization: `Bearer ${bearerToken}`,
        }),
      });
    });

    it('ignores non-Bearer Authorization and falls back to cookie', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: {
          Authorization: `Basic ${token}`,
          Cookie: `id_token=${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it('allows settings when the caller has admin role', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/settings', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it('allows settings with Bearer when the caller has admin role', async () => {
      const token = await createIdToken({ sub: 'alice', groups: ['admin'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it('returns 403 on settings when the caller is not admin', async () => {
      const token = await createIdToken({ sub: 'bob', groups: ['everyone'] });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/settings', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { message: 'Admin access required' } });
    });

    it('returns 401 when the email is outside OIDC_ALLOWED_EMAILS', async () => {
      enableOidcAuth({
        client: oidcClient,
        oidcConfig: { ...OIDC_CONFIG, OIDC_ALLOWED_EMAILS: ['*@company.com'] },
      });
      const token = await createIdToken({ sub: 'alice', groups: ['admin'], email: 'alice@elsewhere.com' });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { message: 'Authentication required' } });
    });

    it('allows a caller whose email matches OIDC_ALLOWED_EMAILS', async () => {
      enableOidcAuth({
        client: oidcClient,
        oidcConfig: { ...OIDC_CONFIG, OIDC_ALLOWED_EMAILS: ['*@company.com'] },
      });
      const token = await createIdToken({ sub: 'alice', groups: ['admin'], email: 'alice@company.com' });
      const res = await createApp(new OidcAuthenticator()).request('/api/v1/models', {
        headers: { Cookie: `id_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: oidcRequestContext({
          subjectId: 'alice',
          isAdmin: true,
          authorization: `Bearer ${token}`,
        }),
      });
    });

    it.each([
      '/healthz',
      '/api/v1/auth/login',
      '/api/v1/auth/callback',
      '/api/v1/mcp-servers/oauth/callback',
      '/api/v1/openapi',
    ])('does not gate public mount %s', async path => {
      const res = await createApp(new OidcAuthenticator()).request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ public: true });
    });
  });
});
