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
import configuration, { type OIDCConfig } from '../../../src/config';
import type { IConfigurationStore } from '../../../src/db/configurationStore';
import type { ISandboxEnvironmentStore, SandboxEnvironmentWithVersion } from '../../../src/db/sandboxEnvironmentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { EmptyUserStore, type IUserStore } from '../../../src/db/userStore';
import type { IWebSearchProviderStore } from '../../../src/db/webSearchProviderStore';
import { setCachedLocalSandboxSupport } from '../../../src/sandbox/localRuntime';
import type { SandboxEnvironmentVersionStatus } from '../../../src/schemas/sandboxEnvironment';
import { TrueFoundryUserStore } from '../../../src/truefoundry/TrueFoundryUserStore';

const silentLogger = createLogger({ silent: true });

const ALL_SETTINGS_ON = {
  model_providers: { enabled: true, manage_providers: true },
  mcp_servers: { enabled: true, manage_providers: true },
  skills: { enabled: true, manage_providers: true },
  sandbox_providers: { enabled: true, manage_providers: true },
  web_search: { enabled: true, manage_providers: true },
  memory: { enabled: true, manage_providers: true },
};

const ALL_SETTINGS_OFF = {
  model_providers: { enabled: false, manage_providers: false },
  mcp_servers: { enabled: false, manage_providers: false },
  skills: { enabled: false, manage_providers: false },
  sandbox_providers: { enabled: false, manage_providers: false },
  web_search: { enabled: false, manage_providers: false },
  memory: { enabled: false, manage_providers: false },
};

const NO_PROVIDER_REASON = 'Web search needs a provider, which is not configured.';
const TENANT_OFF_REASON = 'Web search is turned off for this tenant - an admin can turn it back on in settings.';

let mockActiveDefaultStatus: SandboxEnvironmentVersionStatus | undefined;
let mockLatestDefaultStatus: SandboxEnvironmentVersionStatus | undefined;

function mockDefaultEnvStore(): ISandboxEnvironmentStore {
  const withStatus = (status: SandboxEnvironmentVersionStatus | undefined) =>
    status === undefined ? undefined : ({ version: { status } } as unknown as SandboxEnvironmentWithVersion);
  return {
    getEnvironment: () => Promise.resolve(withStatus(mockLatestDefaultStatus)),
    getActiveEnvironment: () => Promise.resolve(withStatus(mockActiveDefaultStatus)),
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
    mockActiveDefaultStatus = undefined;
    mockLatestDefaultStatus = undefined;
    setCachedLocalSandboxSupport(undefined);
  });

  afterEach(() => {
    setCachedLocalSandboxSupport(undefined);
  });

  function makeRouter({
    authenticator = new StandaloneAuthenticator(),
    webSearchStore,
    tenantWebSearchEnabled = true,
    userStore = new EmptyUserStore(),
  }: {
    authenticator?: Authenticator;
    webSearchStore?: IWebSearchProviderStore;
    tenantWebSearchEnabled?: boolean;
    userStore?: IUserStore;
  } = {}): OpenAPIHono {
    const db = createSqliteDb(':memory:');
    const emptyWebSearchStore: IWebSearchProviderStore = {
      getProvider: () => Promise.resolve(undefined),
      upsertProvider: () => Promise.reject(new Error('not used')),
    };
    const configurationStore: IConfigurationStore = {
      getConfiguration: () =>
        Promise.resolve({
          tenant_id: 'default',
          manifest: { web_search: { enabled: tenantWebSearchEnabled } },
          updated_at: '2026-01-01T00:00:00.000Z',
        }),
      upsertConfiguration: () => Promise.reject(new Error('not used')),
      getOrCreateConfiguration: () => Promise.reject(new Error('not used')),
    };
    return withAuth(
      createCapabilitiesRouter({
        sandboxEnvironmentStore: mockDefaultEnvStore(),
        resolveWebSearchProviderStore: () => webSearchStore ?? emptyWebSearchStore,
        resolveConfigurationStore: () => configurationStore,
        userStore,
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
    mockActiveDefaultStatus = undefined;
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: {
          enabled: false,
          environments: { enabled: true },
        },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox, which is not configured.',
        },
        settings: ALL_SETTINGS_ON,
        web_search: { enabled: false, reason: NO_PROVIDER_REASON },
        session_sharing: { enabled: false },
      },
    });
  });

  it('reports web_search enabled when a provider is configured', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = undefined;
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

  it('reports web_search disabled when the tenant turned it off, even with a provider', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = undefined;
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
    const router = makeRouter({ webSearchStore: configuredStore, tenantWebSearchEnabled: false });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { web_search: { enabled: false, reason: TENANT_OFF_REASON } },
    });
  });

  it('reports sharing with users only when a user source is configured', async () => {
    disableOidcAuth();
    const peekUsers = () => Promise.reject(new Error('not used'));
    const router = makeRouter({ userStore: new TrueFoundryUserStore({ peekUsers }) });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { session_sharing: { enabled: true } },
    });
  });

  it('reports sandbox + skill enabled when local fallback is cached and no image status exists', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = undefined;
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
        sandbox: { enabled: true, environments: { enabled: true } },
        skill: { enabled: true },
        settings: ALL_SETTINGS_ON,
        web_search: { enabled: false, reason: NO_PROVIDER_REASON },
        session_sharing: { enabled: false },
      },
    });
  });

  it('reports sandbox + skill enabled only when the image is ready', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'ready';
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        sandbox: { enabled: true, environments: { enabled: true } },
        skill: { enabled: true },
        settings: ALL_SETTINGS_ON,
        web_search: { enabled: false, reason: NO_PROVIDER_REASON },
        session_sharing: { enabled: false },
      },
    });
  });

  it('stays enabled while a newer default environment version is pending', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'ready';
    mockLatestDefaultStatus = 'pending';
    const router = makeRouter();

    const response = await router.request('/');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
      },
    });
  });

  it('reports sandbox disabled with a "being prepared" skill reason while the image is still pending', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'pending';
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sandbox: { enabled: false, environments: { enabled: true } },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox whose image is still being prepared — retry shortly.',
        },
      },
    });
  });

  it('reports "not configured" skill reason when the image build failed', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'failed';
    const router = makeRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sandbox: { enabled: false, environments: { enabled: true } },
        skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
      },
    });
  });

  it('disables environments when the TrueFoundry on-prem sandbox provider is selected', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'ready';
    const previousStandalone = Reflect.get(configuration, 'STANDALONE');
    const previousSfyUrl = Reflect.get(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
    const previousProvider = Reflect.get(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER');
    Reflect.set(configuration, 'STANDALONE', false);
    Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'http://sfy.example');
    Reflect.set(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER', 'truefoundry');
    try {
      const router = makeRouter();
      const response = await router.request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          sandbox: { enabled: true, environments: { enabled: false } },
        },
      });
    } finally {
      Reflect.set(configuration, 'STANDALONE', previousStandalone);
      if (previousSfyUrl === undefined) {
        Reflect.deleteProperty(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
      } else {
        Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', previousSfyUrl);
      }
      if (previousProvider === undefined) {
        Reflect.deleteProperty(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER');
      } else {
        Reflect.set(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER', previousProvider);
      }
    }
  });

  it('disables environments in TrueFoundry mode when the shared provider is unset', async () => {
    disableOidcAuth();
    mockActiveDefaultStatus = 'ready';
    const previousStandalone = Reflect.get(configuration, 'STANDALONE');
    const previousSfyUrl = Reflect.get(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
    const previousProvider = Reflect.get(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER');
    Reflect.set(configuration, 'STANDALONE', false);
    Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'http://sfy.example');
    Reflect.deleteProperty(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER');
    try {
      const router = makeRouter();
      const response = await router.request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          sandbox: { enabled: true, environments: { enabled: false } },
        },
      });
    } finally {
      Reflect.set(configuration, 'STANDALONE', previousStandalone);
      if (previousSfyUrl === undefined) {
        Reflect.deleteProperty(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
      } else {
        Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', previousSfyUrl);
      }
      if (previousProvider === undefined) {
        Reflect.deleteProperty(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER');
      } else {
        Reflect.set(configuration, 'TRUEFOUNDRY_SANDBOX_PROVIDER', previousProvider);
      }
    }
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
      const allOnConfigurationStore: IConfigurationStore = {
        getConfiguration: () => Promise.resolve(undefined),
        upsertConfiguration: () => Promise.reject(new Error('not used')),
        getOrCreateConfiguration: () => Promise.reject(new Error('not used')),
      };
      const router = withAuth(
        createCapabilitiesRouter({
          sandboxEnvironmentStore: mockDefaultEnvStore(),
          resolveWebSearchProviderStore: () => emptyWebSearchStore,
          resolveConfigurationStore: () => allOnConfigurationStore,
          userStore: new EmptyUserStore(),
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
          sandbox: {
            enabled: false,
            environments: { enabled: true },
          },
          skill: {
            enabled: false,
            reason: 'Skills run in a sandbox, which is not configured.',
          },
          settings: ALL_SETTINGS_ON,
          web_search: { enabled: false, reason: NO_PROVIDER_REASON },
          session_sharing: { enabled: false },
        },
      });

      const userRes = await router.request('/', {
        headers: { Cookie: `id_token=${await createIdToken(['everyone'])}` },
      });
      expect(userRes.status).toBe(200);
      expect(await userRes.json()).toEqual({
        data: {
          sandbox: {
            enabled: false,
            environments: { enabled: true },
          },
          skill: {
            enabled: false,
            reason: 'Skills run in a sandbox, which is not configured.',
          },
          settings: ALL_SETTINGS_OFF,
          web_search: { enabled: false, reason: NO_PROVIDER_REASON },
          session_sharing: { enabled: false },
        },
      });
    });
  });
});
