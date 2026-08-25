// Sandbox capability is driven by the refreshed image status; stub it so tests never touch Daytona.
jest.mock('../../../src/sandbox/providerUtils', () => ({ checkSnapshotStatus: jest.fn() }));

import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { createLogger } from 'winston';
import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import { authMiddleware } from '../../../src/auth/middleware';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import type { OIDCConfig } from '../../../src/config';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { setCachedLocalSandboxSupport } from '../../../src/sandbox/localRuntime';
import { checkSnapshotStatus } from '../../../src/sandbox/providerUtils';
import type { SandboxBuildStatus, SandboxStatus } from '../../../src/schemas/sandboxProvider';

const mockStatus = checkSnapshotStatus as jest.Mock;
const silentLogger = createLogger({ silent: true });

const buildWithStatus = (status: SandboxBuildStatus): SandboxStatus => ({
  status,
  status_reason: status === 'failed' ? 'Sandbox image build failed (build_failed).' : null,
  build_metadata: { build_ref: 'trueforge-build-029ea5ff', image_uri: 'tfy.jfrog.io/tfy-images/sandbox:029ea5ff' },
});

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
  beforeEach(() => {
    mockStatus.mockReset();
    mockStatus.mockResolvedValue(undefined);
    setCachedLocalSandboxSupport(undefined);
  });

  afterEach(() => {
    setCachedLocalSandboxSupport(undefined);
  });

  function makeRouter(): OpenAPIHono {
    const db = createSqliteDb(':memory:');
    return withAuth(
      createCapabilitiesRouter({
        sandboxProviderStore: new SqliteSandboxProviderStore(db),
        withTransaction: callback => db.transaction().execute(callback),
        logger: silentLogger,
      }),
    );
  }

  it('reports sandbox + skill disabled when no image status is available', async () => {
    disableOidcAuth();
    mockStatus.mockResolvedValue(undefined);
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: { enabled: false },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox, which is not configured.',
        },
        settings: { enabled: true },
      },
    });
  });

  it('reports sandbox + skill enabled when local fallback is cached and no image status exists', async () => {
    disableOidcAuth();
    mockStatus.mockResolvedValue(undefined);
    setCachedLocalSandboxSupport({
      supported: true,
      platform: 'darwin',
      shell: '/bin/bash',
      python: '/usr/bin/python3',
    });
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
      },
    });
  });

  it('reports sandbox + skill enabled only when the image is ready', async () => {
    disableOidcAuth();
    mockStatus.mockResolvedValue(buildWithStatus('ready'));
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
      },
    });
  });

  it('reports sandbox disabled with a "being prepared" skill reason while the image is still pending', async () => {
    disableOidcAuth();
    mockStatus.mockResolvedValue(buildWithStatus('pending'));
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sandbox: { enabled: false },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox whose image is still being prepared — retry shortly.',
        },
      },
    });
  });

  it('reports "not configured" skill reason when the image build failed', async () => {
    disableOidcAuth();
    mockStatus.mockResolvedValue(buildWithStatus('failed'));
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sandbox: { enabled: false },
        skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
      },
    });
  });

  it('fails closed (sandbox disabled) when the status check throws', async () => {
    disableOidcAuth();
    mockStatus.mockRejectedValue(new Error('daytona unreachable'));
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { sandbox: { enabled: false } } });
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
          logger: silentLogger,
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
