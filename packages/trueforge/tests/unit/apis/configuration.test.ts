import { sql, type Kysely } from 'kysely';
import { createConfigurationRouter } from '../../../src/apis/configuration';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import type { IConfigurationStore } from '../../../src/db/configurationStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ModelInfo } from '../../../src/db/modelProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteConfigurationStore } from '../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import type { Database } from '../../../src/db/sqlite/types';

function patchInit(manifest: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  };
}

const modelNames = (count: number) => Array.from({ length: count }, (_, index) => `acct/model-${String(index)}`);

/** Lists a fixed set of models, standing in for the models the calling admin has access to. */
class ListedModelsStore extends SqliteModelProviderStore {
  readonly #models: ModelInfo[];

  constructor({ db, names }: { db: Kysely<Database>; names: string[] }) {
    super(db);
    this.#models = names.map(name => ({
      name,
      model_id: name,
      provider: { name: 'acct' },
      properties: {},
      canonicalModel: undefined,
      cost: 1,
    }));
  }

  override listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.#models);
  }
}

/** The admin can access `accessibleModels`; by default the ten models the tests pick from. */
async function createRouter({ accessibleModels = modelNames(10) }: { accessibleModels?: string[] } = {}) {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const store = new SqliteConfigurationStore(db);
  const router = createConfigurationRouter({
    resolveConfigurationStore: () => store,
    resolveModelProviderStore: () => new ListedModelsStore({ db, names: accessibleModels }),
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  return { router, store, db };
}

describe('settings configuration router', () => {
  it('GET reports the defaults (memory on) and materialises the row on first read', async () => {
    const { router, store } = await createRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        manifest: {
          web_search: { enabled: true },
          memory: { enabled: true },
          auto_model_routing: { enabled: true, candidate_models: [] },
        },
        updated_at: expect.any(String),
      },
    });
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: {
        web_search: { enabled: true },
        memory: { enabled: true },
        auto_model_routing: { enabled: true, candidate_models: [] },
      },
      updated_at: expect.any(String),
    });
  });

  it('PATCH saves the switches and a later GET reads them back', async () => {
    const { router } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });

    const get = await router.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });
  });

  it('PATCH on a tenant with nothing saved starts from the defaults', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: true } },
    });
  });

  it('PATCH can turn web search back on', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const reEnabled = await router.request('/', patchInit({ web_search: { enabled: true } }));
    expect(reEnabled.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: true }, memory: { enabled: true } },
    });
  });

  it('PATCH turns memory off without touching web search', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ memory: { enabled: false } }));
    expect(patched.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: true }, memory: { enabled: false } },
    });
  });

  it('PATCH turns Auto mode off without touching the other switches', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));
    expect(patched.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: {
        web_search: { enabled: true },
        memory: { enabled: true },
        auto_model_routing: { enabled: false, candidate_models: [] },
      },
    });
  });

  describe('Auto mode model candidate list', () => {
    const tenantId = STANDALONE_REQUEST_CONTEXT.tenant_id;
    const four = modelNames(4);

    it('starts empty, which allows no model', async () => {
      const { router, store } = await createRouter();

      expect(await (await router.request('/')).json()).toMatchObject({
        data: { manifest: { auto_model_routing: { enabled: true, candidate_models: [] } } },
      });
      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing).toEqual({ enabled: true, candidate_models: [] });
    });

    it('rejects models the admin has no access to, and saves nothing', async () => {
      const { router, store } = await createRouter({ accessibleModels: four });
      const lacking = ['acct/model-0', 'acct/model-1', 'acct/model-2', 'acct/secret-a', 'acct/secret-b'];

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: lacking } }));

      expect(patched.status).toBe(400);
      expect(await patched.json()).toEqual({
        error: { message: "You don't have access to these models: acct/secret-a, acct/secret-b." },
      });
      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing.candidate_models ?? []).toEqual([]);
    });

    it('accepts models the admin has access to', async () => {
      const { router } = await createRouter({ accessibleModels: four });

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      expect(patched.status).toBe(200);
    });

    it('does not check access when only the switch changes, so a saved list survives', async () => {
      const { router, store, db } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));
      const restricted = createConfigurationRouter({
        resolveConfigurationStore: () => store,
        resolveModelProviderStore: () => new ListedModelsStore({ db, names: [] }),
        resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
      });

      const patched = await restricted.request('/', patchInit({ auto_model_routing: { enabled: false } }));

      expect(patched.status).toBe(200);
      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing).toEqual({ enabled: false, candidate_models: four });
    });

    it('PATCH saves the list, dropping duplicates, and a later GET reads it back', async () => {
      const { router } = await createRouter();

      const patched = await router.request(
        '/',
        patchInit({ auto_model_routing: { candidate_models: [...four, 'acct/model-0'] } }),
      );
      expect(patched.status).toBe(200);

      expect(await (await router.request('/')).json()).toMatchObject({
        data: { manifest: { auto_model_routing: { enabled: true, candidate_models: four } } },
      });
    });

    it('PATCH of the switch alone keeps the saved list', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      const patched = await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));
      expect(patched.status).toBe(200);

      await expect(store.getConfiguration(tenantId)).resolves.toMatchObject({
        manifest: { auto_model_routing: { enabled: false, candidate_models: four } },
      });
    });

    it('PATCH of the list alone keeps the switch', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));

      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      await expect(store.getConfiguration(tenantId)).resolves.toMatchObject({
        manifest: { auto_model_routing: { enabled: false, candidate_models: four } },
      });
    });

    it('PATCH with an empty list removes every model', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: [] } }));
      expect(patched.status).toBe(200);

      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing).toEqual({ enabled: true, candidate_models: [] });
    });

    it.each([1, 2, 3])('PATCH rejects a list of %i model(s), below the minimum of four', async count => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      const patched = await router.request(
        '/',
        patchInit({ auto_model_routing: { candidate_models: modelNames(count) } }),
      );
      expect(patched.status).toBe(400);

      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing.candidate_models).toEqual(four);
    });

    it('PATCH counts a repeated model once toward the minimum', async () => {
      const { router } = await createRouter();

      const repeated = Array.from({ length: 4 }, () => 'acct/model-0');
      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: repeated } }));
      expect(patched.status).toBe(400);
    });

    it('PATCH accepts exactly four models', async () => {
      const { router } = await createRouter();

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));
      expect(patched.status).toBe(200);
    });

    it('PATCH accepts ten models and rejects eleven', async () => {
      const { router, store } = await createRouter();

      const ten = await router.request('/', patchInit({ auto_model_routing: { candidate_models: modelNames(10) } }));
      expect(ten.status).toBe(200);
      const eleven = await router.request('/', patchInit({ auto_model_routing: { candidate_models: modelNames(11) } }));
      expect(eleven.status).toBe(400);

      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing.candidate_models).toEqual(modelNames(10));
    });

    it.each(['', 'sonnet', '/sonnet', 'acct/', 'acct/team/sonnet'])(
      'PATCH rejects "%s" as a model name',
      async name => {
        const { router } = await createRouter();

        const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: [name] } }));
        expect(patched.status).toBe(400);
      },
    );

    it('PATCH rejects null for the list', async () => {
      const { router } = await createRouter();

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: null } }));
      expect(patched.status).toBe(400);
    });
  });

  it('PATCH leaves switches the body does not mention', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const empty = await router.request('/', patchInit({}));
    expect(empty.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: true } },
    });
  });

  it('GET does not roll back an update that landed while it was in flight', async () => {
    const { store, db } = await createRouter();
    const tenant_id = STANDALONE_REQUEST_CONTEXT.tenant_id;
    // Stands in for a PATCH committing after the GET found no row.
    const racingStore: IConfigurationStore = {
      getConfiguration: tenant => store.getConfiguration(tenant),
      upsertConfiguration: input => store.upsertConfiguration(input),
      getOrCreateConfiguration: async input => {
        await store.upsertConfiguration({
          tenant_id,
          manifest: {
            web_search: { enabled: false },
            memory: { enabled: false },
            auto_model_routing: { enabled: true, candidate_models: [] },
          },
        });
        return await store.getOrCreateConfiguration(input);
      },
      listTenantIdsWithFeatureEnabled: feature => store.listTenantIdsWithFeatureEnabled(feature),
    };
    const router = createConfigurationRouter({
      resolveConfigurationStore: () => racingStore,
      resolveModelProviderStore: () => new ListedModelsStore({ db, names: [] }),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: false } } },
    });
    await expect(store.getConfiguration(tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: false } },
    });
  });

  it('seeds memory on into a row saved without it, keeping the switches it has', async () => {
    const { router, db } = await createRouter();
    const tenant_id = STANDALONE_REQUEST_CONTEXT.tenant_id;
    await sql`INSERT INTO configuration (tenant_id, manifest, updated_at)
      VALUES (${tenant_id}, jsonb('{"web_search":{"enabled":false}}'), ${new Date().toISOString()})`.execute(db);

    const read = await router.request('/');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });

    // Aliased away from `manifest` so the raw stored document is read.
    const stored = await sql<{
      raw: string;
    }>`SELECT json(manifest) AS raw FROM configuration WHERE tenant_id = ${tenant_id}`.execute(db);
    expect(JSON.parse(stored.rows[0]?.raw ?? 'null')).toEqual({
      web_search: { enabled: false },
      memory: { enabled: true },
      auto_model_routing: { enabled: true, candidate_models: [] },
    });
  });

  it('PATCH rejects a switch the server does not know about', async () => {
    const { router } = await createRouter();
    const patched = await router.request(
      '/',
      patchInit({ web_search: { enabled: true }, sandbox: { enabled: false } }),
    );
    expect(patched.status).toBe(400);
  });
});
