import { createLogger } from 'winston';
import { createCatalogRouter } from '../../../src/apis/catalog';
import { createSandboxProvidersRouter } from '../../../src/apis/sandboxProviders';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { WebSearchCatalog } from '../../../src/catalog/WebSearchCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ISandboxProviderStore } from '../../../src/db/sandboxProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { toRedactedSecretValue } from '../../../src/utils/secretRedaction';

jest.mock('../../../src/sandbox/providerUtils', () => {
  const actual = jest.requireActual<typeof import('../../../src/sandbox/providerUtils')>(
    '../../../src/sandbox/providerUtils',
  );
  return {
    ...actual,
    validateSandboxProviderAccess: jest.fn(async () => undefined),
  };
});

const logger = createLogger({ silent: true });

const putBody = {
  type: 'daytona' as const,
  auth: { api_key: 'dtn-test-secret' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

const putBodyWire = {
  manifest: {
    ...putBody,
    auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
  },
};

function wrapManifest(manifest: unknown) {
  return { manifest };
}

function putInit(manifest: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(wrapManifest(manifest)),
  };
}

async function createRouters(): Promise<{
  settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;
  sandboxProviderStore: ISandboxProviderStore;
}> {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sandboxProviderStore = new SqliteSandboxProviderStore(db);
  return {
    settingsRouter: createSandboxProvidersRouter({
      resolveSandboxProviderStore: () => sandboxProviderStore,
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      withTransaction: callback => db.transaction().execute(callback),
      logger,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    }),
    sandboxProviderStore,
  };
}

describe('sandboxProviders router', () => {
  let settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;
  let catalogRouter: ReturnType<typeof createCatalogRouter>;
  let sandboxProviderStore: SqliteSandboxProviderStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sandboxProviderStore = new SqliteSandboxProviderStore(db);
    settingsRouter = createSandboxProvidersRouter({
      resolveSandboxProviderStore: () => sandboxProviderStore,
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      withTransaction: callback => db.transaction().execute(callback),
      logger,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
      webSearchCatalog: WebSearchCatalog.load(),
    });
  });

  it('GET /catalogs/sandbox-providers returns the shipped catalog verbatim', async () => {
    const response = await catalogRouter.request('/sandbox-providers');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [...SandboxCatalog.load().list()] });
  });

  it('GET / returns 404 when none configured', async () => {
    const response = await settingsRouter.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No sandbox provider configured' } });
  });

  it('GET / returns 404 when only an env-managed truefoundry provider exists', async () => {
    const { settingsRouter: router, sandboxProviderStore: store } = await createRouters();
    await store.upsertSandboxProvider({
      tenant_id: 'default',
      manifest: {
        type: 'truefoundry',
        server_url: 'http://sandbox-server',
        nats_bridge_url: 'ws://nats-bridge',
        exec_timeout_ms: 60_000,
      },
    });

    const response = await router.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No sandbox provider configured' } });
  });

  it('PUT upserts credentials + default env, GET returns redacted auth', async () => {
    const put = await settingsRouter.request('/', putInit(putBody));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ data: putBodyWire });

    const get = await settingsRouter.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ data: putBodyWire });

    const stored = await sandboxProviderStore.getSandboxProvider('default');
    expect(stored?.manifest).toEqual(putBody);
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { auth: _auth, ...withoutAuth } = putBody;
    const missingAuth = await settingsRouter.request('/', putInit(withoutAuth));
    expect(missingAuth.status).toBe(400);
  });
});
