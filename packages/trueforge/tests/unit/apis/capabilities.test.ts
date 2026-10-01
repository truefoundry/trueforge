import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Configuration } from 'openid-client';
import { createLogger } from 'winston';
import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import type { Authenticator } from '../../../src/auth/authenticator';
import { resolveRequestContext } from '../../../src/auth/identity';
import { createAuthMiddleware } from '../../../src/auth/middleware';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import { OidcAuthenticator } from '../../../src/auth/oidcAuthenticator';
import { StandaloneAuthenticator } from '../../../src/auth/standaloneAuthenticator';
import type { OIDCConfig } from '../../../src/config';
import type { ISandboxEnvironmentStore, SandboxEnvironmentWithVersion } from '../../../src/db/sandboxEnvironmentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import type { IWebSearchProviderStore } from '../../../src/db/webSearchProviderStore';
import { setCachedLocalSandboxSupport } from '../../../src/sandbox/localRuntime';
import type { SandboxEnvironmentVersionStatus } from '../../../src/schemas/sandboxEnvironment';

const silentLogger = createLogger({ silent: true });

let mockDefaultStatus: SandboxEnvironmentVersionStatus | undefined;

function mockDefaultEnvStore(): ISandboxEnvironmentStore {
  return {
    getEnvironment: () =>
      Promise.resolve(
        mockDefaultStatus === undefined
          ? undefined
          : ({ version: { status: mockDefaultStatus } } as unknown as SandboxEnvironmentWithVersion),
      ),
  } as unknown as ISandboxEnvironmentStore;
}

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

function withAuth(router: OpenAPIHono, authenticator: Authenticator): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', createAuthMiddleware(authenticator));
  shell.route('/', router);
  return shell;
}

describe('capabilities routers', () => {
  beforeEach(() => {
    mockDefaultStatus = undefined;
    setCachedLocalSandboxSupport(undefined);
  });

  afterEach(() => {
    setCachedLocalSandboxSupport(undefined);
  });

  function makeRouter({
    authenticator = new StandaloneAuthenticator(),
    webSearchStore,
  }: {
    authenticator?: Authenticator;
    webSearchStore?: IWebSearchProviderStore;
  } = {}): OpenAPIHono {
    const db = createSqliteDb(':memory:');
    const emptyWebSearchStore: IWebSearchProviderStore = {
      getProvider: () => Promise.resolve(undefined),
      upsertProvider: () => Promise.reject(new Error('not used')),
    };
    return withAuth(
      createCapabilitiesRouter({
        sandboxEnvironmentStore: mockDefaultEnvStore(),
        resolveWebSearchProviderStore: () => webSearchStore ?? emptyWebSearchStore,
        withTransaction: (() => {
          const run = <T>(callback: (trx: never) => Promise<T>): Promise<T> =>
            db.transaction().execute(callback as never);
          return run;
        })() as never,
        logger: silentLogger,
        resolveRequestContext,
      }),
      authenticator,
    );
  }

  it('reports sandbox + skill disabled when no image status is available', async () => {
    disableOidcAuth();
    mockDefaultStatus = undefined;
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
        web_search: { enabled: false },
      },
    });
  });

  it('reports web_search enabled when a provider is configured', async () => {
    disableOidcAuth();
    mockDefaultStatus = undefined;
    const configuredStore: IWebSearchProviderStore = {
      getProvider: () =>
        Promise.resolve({
          tenant_id: 'default',
          manifest: { type: 'parallel', auth: { api_key: 'test-key' } },
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }),
      upsertProvider: () => Promise.reject(new Error('not used')),
    };
    const router = makeRouter({ webSearchStore: configuredStore });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { web_search: { enabled: true } },
    });
  });

  it('reports sandbox + skill enabled when local fallback is cached and no image status exists', async () => {
    disableOidcAuth();
    mockDefaultStatus = undefined;
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
        web_search: { enabled: false },
      },
    });
  });

  it('reports sandbox + skill enabled only when the image is ready', async () => {
    disableOidcAuth();
    mockDefaultStatus = 'ready';
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
        web_search: { enabled: false },
      },
    });
  });

  it('reports sandbox disabled with a "being prepared" skill reason while the image is still pending', async () => {
    disableOidcAuth();
    mockDefaultStatus = 'pending';
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
    mockDefaultStatus = 'failed';
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
      const emptyWebSearchStore: IWebSearchProviderStore = {
        getProvider: () => Promise.resolve(undefined),
        upsertProvider: () => Promise.reject(new Error('not used')),
      };
      const router = withAuth(
        createCapabilitiesRouter({
          sandboxEnvironmentStore: mockDefaultEnvStore(),
          resolveWebSearchProviderStore: () => emptyWebSearchStore,
          withTransaction: (() => {
            const run = <T>(callback: (trx: never) => Promise<T>): Promise<T> =>
              db.transaction().execute(callback as never);
            return run;
          })() as never,
          logger: silentLogger,
          resolveRequestContext,
        }),
        new OidcAuthenticator(),
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
          web_search: { enabled: false },
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
          web_search: { enabled: false },
        },
      });
    });
  });
});
