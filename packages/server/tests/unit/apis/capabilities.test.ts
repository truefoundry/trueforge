import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import { authMiddleware } from '../../../src/auth/middleware';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import type { OIDCConfig } from '../../../src/config';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';

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

function withAuth(router: OpenAPIHono): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', authMiddleware);
  shell.route('/', router);
  return shell;
}

describe('capabilities routers', () => {
  it('capabilities derive sandbox and skill from the store', async () => {
    disableOidcAuth();
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const store = new SqliteSandboxProviderStore(db);
    const router = withAuth(
      createCapabilitiesRouter({
        sandboxProviderStore: store,
        withTransaction: callback => db.transaction().execute(callback),
      }),
    );

    const empty = await router.request('/');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      data: {
        sandbox: { enabled: false },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox, which is not configured.',
        },
        settings: { enabled: true },
      },
    });

    await store.upsertSandboxProvider({
      tenant_id: 'default',
      manifest: {
        type: 'daytona',
        snapshot_name: 'trueforge-sandbox-image',
        auth: { api_key: 'dtn-test' },
        exec_timeout_ms: 60000,
        auto_stop_interval_in_minutes: 5,
        auto_archive_interval_in_minutes: 60,
        auto_delete_interval_in_minutes: 7200,
      },
    });

    const configured = await router.request('/');
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
      },
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

    async function createIdToken(groups: string[]): Promise<string> {
      return new SignJWT({ groups })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
    }

    it('marks settings enabled for admin callers and disabled for non-admin callers', async () => {
      const db = createSqliteDb(':memory:');
      await migrateSqliteToLatest(db);
      const router = withAuth(
        createCapabilitiesRouter({
          sandboxProviderStore: new SqliteSandboxProviderStore(db),
          withTransaction: callback => db.transaction().execute(callback),
        }),
      );

      const adminRes = await router.request('/', {
        headers: { Cookie: `id_token=${await createIdToken(['admin'])}` },
      });
      expect(adminRes.status).toBe(200);
      expect(await adminRes.json()).toEqual({
        data: {
          sandbox: { enabled: false },
          skill: {
            enabled: false,
            reason: 'Skills run in a sandbox, which is not configured.',
          },
          settings: { enabled: true },
        },
      });

      const userRes = await router.request('/', {
        headers: { Cookie: `id_token=${await createIdToken(['everyone'])}` },
      });
      expect(userRes.status).toBe(200);
      expect(await userRes.json()).toEqual({
        data: {
          sandbox: { enabled: false },
          skill: {
            enabled: false,
            reason: 'Skills run in a sandbox, which is not configured.',
          },
          settings: { enabled: false },
        },
      });
    });
  });
});
