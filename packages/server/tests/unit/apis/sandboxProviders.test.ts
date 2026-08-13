import { createCatalogRouter } from '../../../src/apis/catalog';
import { createSandboxProvidersRouter } from '../../../src/apis/sandboxProviders';
import { TENANT_ID } from '../../../src/apis/sessions';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ISandboxProviderStore } from '../../../src/db/sandboxProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { toRedactedSecretValue } from '../../../src/utils/secretRedaction';

const putBody = {
  type: 'daytona' as const,
  snapshot_name: 'trueforge-sandbox-image',
  auth: { api_key: 'dtn-test-secret' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

const putBodyWire = {
  ...putBody,
  auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
      sandboxProviderStore,
      withTransaction: callback => db.transaction().execute(callback),
    }),
    sandboxProviderStore,
  };
}

describe('sandboxProviders router', () => {
  let settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;
  let catalogRouter: ReturnType<typeof createCatalogRouter>;
  // Concrete store keeps TTransaction as Transaction<Database>; the interface default is `never`.
  let sandboxProviderStore: SqliteSandboxProviderStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sandboxProviderStore = new SqliteSandboxProviderStore(db);
    settingsRouter = createSandboxProvidersRouter({
      sandboxProviderStore,
      withTransaction: callback => db.transaction().execute(callback),
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
    });
  });

  it('GET /catalog/sandbox-providers returns the shipped catalog verbatim', async () => {
    const response = await catalogRouter.request('/sandbox-providers');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [...SandboxCatalog.load().list()] });
  });

  it('GET / returns 404 when none configured', async () => {
    const response = await settingsRouter.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No sandbox provider configured' } });
  });

  it('PUT upserts the singleton provider and GET returns redacted auth', async () => {
    const put = await settingsRouter.request('/', putInit(putBody));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ data: putBodyWire });

    const get = await settingsRouter.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ data: putBodyWire });

    const stored = await sandboxProviderStore.getSandboxProvider(TENANT_ID);
    expect(stored?.manifest).toEqual(putBody);
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { auth: _, ...withoutAuth } = putBody;
    const missingAuth = await settingsRouter.request('/', putInit(withoutAuth));
    expect(missingAuth.status).toBe(400);

    const badType = await settingsRouter.request('/', putInit({ ...putBody, type: 'unknown' }));
    expect(badType.status).toBe(400);
  });
});

describe('sandbox-provider secret redaction and strict PUT', () => {
  it('PUT create with a redacted api_key returns 400', async () => {
    const { settingsRouter } = await createRouters();
    const response = await settingsRouter.request(
      '/',
      putInit({
        ...putBody,
        auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'API key is required' } });
  });

  it('PUT with a redacted api_key keeps the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const redactedKeep = {
      ...putBody,
      snapshot_name: 'other-snapshot',
      exec_timeout_ms: 120000,
      auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
    };
    const update = await settingsRouter.request('/', putInit(redactedKeep));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({
      data: {
        ...redactedKeep,
        auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
      },
    });

    const stored = await sandboxProviderStore.getSandboxProvider(TENANT_ID);
    expect(stored?.manifest).toEqual({
      ...putBody,
      snapshot_name: 'other-snapshot',
      exec_timeout_ms: 120000,
    });
  });

  it('PUT with a different redacted api_key still keeps the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const keep = {
      ...putBody,
      snapshot_name: 'kept-snapshot',
      auth: { api_key: 'oth-***REDACTED***-xxx' },
    };
    const response = await settingsRouter.request('/', putInit(keep));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ...keep,
        auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
      },
    });

    const stored = await sandboxProviderStore.getSandboxProvider(TENANT_ID);
    expect(stored?.manifest).toEqual({
      ...putBody,
      snapshot_name: 'kept-snapshot',
    });
  });

  it('PUT with a real api_key rotates the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const rotatedKey = 'dtn-rotated-key';
    const rotated = { ...putBody, auth: { api_key: rotatedKey } };
    const update = await settingsRouter.request('/', putInit(rotated));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({
      data: {
        ...rotated,
        auth: { api_key: toRedactedSecretValue(rotatedKey) },
      },
    });

    const stored = await sandboxProviderStore.getSandboxProvider(TENANT_ID);
    expect(stored?.manifest.auth.api_key).toBe(rotatedKey);
  });
});
