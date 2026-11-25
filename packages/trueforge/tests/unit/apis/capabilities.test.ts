import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Kysely } from 'kysely';
import type { Configuration } from 'openid-client';
import { createLogger } from 'winston';
import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import type { Authenticator } from '../../../src/auth/authenticator';
import { resolveRequestContext } from '../../../src/auth/identity';
import { createAuthMiddleware } from '../../../src/auth/middleware';
import { disableOidcAuth, enableOidcAuth, initOidc } from '../../../src/auth/oidc';
import { OidcAuthenticator } from '../../../src/auth/oidcAuthenticator';
import { StandaloneAuthenticator } from '../../../src/auth/standaloneAuthenticator';
import configuration, { parseTrueFoundryModelRouting, type OIDCConfig } from '../../../src/config';
import type { IConfigurationStore } from '../../../src/db/configurationStore';
import type { IMemoryProviderStore } from '../../../src/db/memoryProviderStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { IModelProviderStore, ModelInfo } from '../../../src/db/modelProviderStore';
import type { ISandboxEnvironmentStore, SandboxEnvironmentWithVersion } from '../../../src/db/sandboxEnvironmentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import type { Database } from '../../../src/db/sqlite/types';
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
  memory_providers: { enabled: true, manage_providers: true },
};

const ALL_SETTINGS_OFF = {
  model_providers: { enabled: false, manage_providers: false },
  mcp_servers: { enabled: false, manage_providers: false },
  skills: { enabled: false, manage_providers: false },
  sandbox_providers: { enabled: false, manage_providers: false },
  web_search: { enabled: false, manage_providers: false },
  memory_providers: { enabled: false, manage_providers: false },
};

const NO_PROVIDER_REASON = 'Web search needs a provider, which is not configured.';
const TENANT_OFF_REASON = 'Web search is turned off for this tenant - an admin can turn it back on in settings.';
const MEMORY_TENANT_OFF_REASON = 'Memory is turned off for this tenant - an admin can turn it back on in settings.';
const AUTO_TENANT_OFF_REASON = 'Auto mode is turned off for this tenant - an admin can turn it back on in settings.';
const AUTO_MODELS_RESTRICTED_REASON =
  'Auto mode has no usable models selected - an admin can choose models for it in settings.';

function routableModel({ name, canonicalModel }: { name: string; canonicalModel: string | undefined }): ModelInfo {
  return { name, model_id: name, provider: { name: 'acct' }, properties: {}, canonicalModel, cost: 1 };
}

/** Lists a fixed set of models, standing in for a catalog that reports canonical ids. */
class ListedModelsStore extends SqliteModelProviderStore {
  readonly #models: ModelInfo[];

  constructor({ db, models }: { db: Kysely<Database>; models: ModelInfo[] }) {
    super(db);
    this.#models = models;
  }

  override listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.#models);
  }
}

let mockActiveDefaultStatus: SandboxEnvironmentVersionStatus | undefined;
let mockLatestDefaultStatus: SandboxEnvironmentVersionStatus | undefined;

function mockDefaultEnvStore(): ISandboxEnvironmentStore {
  const withStatus = (status: SandboxEnvironmentVersionStatus | undefined) =>
    status === undefined ? undefined : ({ version: { status } } as unknown as SandboxEnvironmentWithVersion);
  return {
    getEnvironment: () => Promise.resolve(withStatus(mockLatestDefaultStatus)),
    getActiveEnvironment: () => Promise.resolve(withStatus(mockActiveDefaultStatus)),
    getDefaultEnvironment: () => Promise.resolve(withStatus(mockActiveDefaultStatus)),
    hasUsableEnvironment: () => Promise.resolve(mockActiveDefaultStatus === 'ready'),
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
    tenantMemoryEnabled = true,
    tenantAutoEnabled = true,
    tenantAutoAllowedModels = [],
    hasMemoryProvider = true,
    userStore = new EmptyUserStore(),
    modelProviderStore,
  }: {
    authenticator?: Authenticator;
    webSearchStore?: IWebSearchProviderStore;
    tenantWebSearchEnabled?: boolean;
    tenantMemoryEnabled?: boolean;
    tenantAutoEnabled?: boolean;
    tenantAutoAllowedModels?: string[];
    hasMemoryProvider?: boolean;
    userStore?: IUserStore;
    modelProviderStore?: IModelProviderStore;
  } = {}): OpenAPIHono {
    const db = createSqliteDb(':memory:');
    const emptyWebSearchStore: IWebSearchProviderStore = {
      getProvider: () => Promise.resolve(undefined),
      upsertProvider: () => Promise.reject(new Error('not used')),
    };
    const memoryStore: IMemoryProviderStore = {
      getProvider: tenantId =>
        Promise.resolve(
          hasMemoryProvider
            ? {
                tenant_id: tenantId,
                manifest: { type: 'zep', auth: { api_key: 'zep-test-key' } },
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              }
            : undefined,
        ),
      upsertProvider: () => Promise.reject(new Error('not used')),
    };
    const storedConfiguration = {
      tenant_id: 'default',
      manifest: {
        web_search: { enabled: tenantWebSearchEnabled },
        memory: { enabled: tenantMemoryEnabled },
        auto_model_routing: { enabled: tenantAutoEnabled, allowed_models: tenantAutoAllowedModels },
      },
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const configurationStore: IConfigurationStore = {
      getConfiguration: () => Promise.resolve(storedConfiguration),
      upsertConfiguration: () => Promise.reject(new Error('not used')),
      getOrCreateConfiguration: () => Promise.resolve(storedConfiguration),
      listTenantIdsWithFeatureEnabled: () => Promise.reject(new Error('not used')),
    };
    return withAuth(
      createCapabilitiesRouter({
        sandboxEnvironmentStore: mockDefaultEnvStore(),
        webSearchProviderStore: webSearchStore ?? emptyWebSearchStore,
        configurationStore,
        memoryProviderStore: memoryStore,
        resolveModelProviderStore: () => modelProviderStore ?? new SqliteModelProviderStore(db),
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
        memory: { enabled: true },
        auto: { status: 'not_configured' },
        session_sharing: { granularity: 'tenant' },
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

  it('reports memory disabled with a reason when the tenant turned it off', async () => {
    disableOidcAuth();
    const router = makeRouter({ tenantMemoryEnabled: false });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        memory: {
          enabled: false,
          reason: MEMORY_TENANT_OFF_REASON,
        },
      },
    });
  });

  it('omits memory but keeps memory providers open in OSS until a provider is configured', async () => {
    disableOidcAuth();
    const router = makeRouter({ hasMemoryProvider: false });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      data: { settings: { memory_providers: { enabled: true, manage_providers: true } } },
    });
    expect(body).not.toHaveProperty('data.memory');
  });

  describe('auto', () => {
    const routingForDefaultTenant = parseTrueFoundryModelRouting(
      JSON.stringify({
        decision_model: { name: 'typesafe/jev-1.13.0', api_key: 'test-routing-key' },
        tenants: { default: { enabled: 'on' } },
      }),
    );

    const routingKeys = ['STANDALONE', 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'TRUEFOUNDRY_MODEL_ROUTING'] as const;
    let previousRouting: Map<(typeof routingKeys)[number], unknown> | undefined;

    function enableModelRouting() {
      previousRouting = new Map(routingKeys.map(key => [key, Reflect.get(configuration, key)]));
      Reflect.set(configuration, 'STANDALONE', false);
      Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'http://sfy.example');
      Reflect.set(configuration, 'TRUEFOUNDRY_MODEL_ROUTING', routingForDefaultTenant);
    }

    afterEach(() => {
      for (const [key, value] of previousRouting ?? []) {
        Reflect.set(configuration, key, value);
      }
      previousRouting = undefined;
    });

    it('reports auto not configured, without a reason, when model routing is not set up for the tenant', async () => {
      disableOidcAuth();
      const response = await makeRouter().request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty('data.auto', { status: 'not_configured' });
    });

    it('reports auto disabled with a reason when the tenant turned it off', async () => {
      disableOidcAuth();
      enableModelRouting();
      const response = await makeRouter({ tenantAutoEnabled: false }).request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { auto: { status: 'disabled', reason: AUTO_TENANT_OFF_REASON } },
      });
    });

    it('reports auto disabled when the tenant allows it but has no models to route to', async () => {
      disableOidcAuth();
      enableModelRouting();
      const db = createSqliteDb(':memory:');
      await migrateSqliteToLatest(db);
      const response = await makeRouter({ modelProviderStore: new SqliteModelProviderStore(db) }).request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { auto: { status: 'disabled', reason: 'Auto mode is not available for now' } },
      });
    });

    describe('with an admin allow-list', () => {
      // Sonnet alone covers every routing category; Haiku misses the adaptive one.
      const sonnet = 'acct/sonnet';
      const haiku = 'acct/haiku';
      const outsideClusters = 'acct/unclustered';

      async function autoStatus(allowedModels: string[]) {
        disableOidcAuth();
        enableModelRouting();
        const db = createSqliteDb(':memory:');
        const response = await makeRouter({
          tenantAutoAllowedModels: allowedModels,
          modelProviderStore: new ListedModelsStore({
            db,
            models: [
              routableModel({ name: sonnet, canonicalModel: 'anthropic/claude-sonnet-5-5' }),
              routableModel({ name: haiku, canonicalModel: 'anthropic/claude-haiku-5-5' }),
              routableModel({ name: outsideClusters, canonicalModel: undefined }),
            ],
          }),
        }).request('/');
        expect(response.status).toBe(200);
        return await response.json();
      }

      it('enables auto when the allowed models can route every category', async () => {
        expect(await autoStatus([sonnet])).toMatchObject({ data: { auto: { status: 'enabled' } } });
      });

      it('ignores allowed models the user does not have access to', async () => {
        expect(await autoStatus([sonnet, 'acct/not-visible'])).toMatchObject({
          data: { auto: { status: 'enabled' } },
        });
      });

      it('tells the admin when the allowed models cannot route every category', async () => {
        expect(await autoStatus([haiku])).toMatchObject({
          data: { auto: { status: 'disabled', reason: AUTO_MODELS_RESTRICTED_REASON } },
        });
      });

      it('disables auto for an empty allow-list, even though the user has routable models', async () => {
        expect(await autoStatus([])).toMatchObject({
          data: { auto: { status: 'disabled', reason: AUTO_MODELS_RESTRICTED_REASON } },
        });
      });

      it('disables auto when allowed models are outside every routing cluster', async () => {
        expect(await autoStatus([outsideClusters])).toMatchObject({
          data: { auto: { status: 'disabled', reason: AUTO_MODELS_RESTRICTED_REASON } },
        });
      });

      it('reports the generic reason when the user lacks the models regardless of the allow-list', async () => {
        disableOidcAuth();
        enableModelRouting();
        const response = await makeRouter({
          tenantAutoAllowedModels: [haiku],
          modelProviderStore: new ListedModelsStore({
            db: createSqliteDb(':memory:'),
            models: [routableModel({ name: haiku, canonicalModel: 'anthropic/claude-haiku-5-5' })],
          }),
        }).request('/');
        expect(await response.json()).toMatchObject({
          data: { auto: { status: 'disabled', reason: 'Auto mode is not available for now' } },
        });
      });
    });

    it('keeps the model providers section closed while the platform owns the catalog, even with auto set up', async () => {
      disableOidcAuth();
      enableModelRouting();
      const response = await makeRouter({ tenantAutoEnabled: false }).request('/');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          auto: { status: 'disabled' },
          settings: { model_providers: { enabled: false, manage_providers: false } },
        },
      });
    });
  });

  it.each([
    { granularity: 'tenant', userStore: new EmptyUserStore() },
    {
      granularity: 'subject',
      userStore: new TrueFoundryUserStore({ peekUsers: () => Promise.reject(new Error('not used')) }),
    },
  ])('reports $granularity sharing granularity based on user lookup support', async ({ granularity, userStore }) => {
    disableOidcAuth();
    const router = makeRouter({ userStore });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toHaveProperty('data.session_sharing', { granularity });
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
        memory: { enabled: true },
        auto: { status: 'not_configured' },
        session_sharing: { granularity: 'tenant' },
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
        memory: { enabled: true },
        auto: { status: 'not_configured' },
        session_sharing: { granularity: 'tenant' },
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
        getOrCreateConfiguration: input =>
          Promise.resolve({
            tenant_id: input.tenant_id,
            manifest: input.default_manifest,
            updated_at: '2026-01-01T00:00:00.000Z',
          }),
        listTenantIdsWithFeatureEnabled: () => Promise.reject(new Error('not used')),
      };
      const zepMemoryStore: IMemoryProviderStore = {
        getProvider: tenantId =>
          Promise.resolve({
            tenant_id: tenantId,
            manifest: { type: 'zep', auth: { api_key: 'zep-test-key' } },
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          }),
        upsertProvider: () => Promise.reject(new Error('not used')),
      };
      const router = withAuth(
        createCapabilitiesRouter({
          sandboxEnvironmentStore: mockDefaultEnvStore(),
          webSearchProviderStore: emptyWebSearchStore,
          configurationStore: allOnConfigurationStore,
          memoryProviderStore: zepMemoryStore,
          resolveModelProviderStore: () => new SqliteModelProviderStore(db),
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
          memory: { enabled: true },
          auto: { status: 'not_configured' },
          session_sharing: { granularity: 'tenant' },
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
          memory: { enabled: true },
          auto: { status: 'not_configured' },
          session_sharing: { granularity: 'tenant' },
        },
      });
    });
  });
});
