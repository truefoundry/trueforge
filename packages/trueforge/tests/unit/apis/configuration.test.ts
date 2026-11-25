import { sql } from 'kysely';
import { createConfigurationRouter } from '../../../src/apis/configuration';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import type { IConfigurationStore } from '../../../src/db/configurationStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteConfigurationStore } from '../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';

function patchInit(manifest: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  };
}

async function createRouter() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const store = new SqliteConfigurationStore(db);
  const router = createConfigurationRouter({
    resolveConfigurationStore: () => store,
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
          auto_model_routing: { enabled: true, allowed_models: [] },
        },
        updated_at: expect.any(String),
      },
    });
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: {
        web_search: { enabled: true },
        memory: { enabled: true },
        auto_model_routing: { enabled: true, allowed_models: [] },
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
        auto_model_routing: { enabled: false, allowed_models: [] },
      },
    });
  });

  describe('Auto mode model allow-list', () => {
    const tenantId = STANDALONE_REQUEST_CONTEXT.tenant_id;
    const sonnet = 'acct/sonnet';
    const haiku = 'acct/haiku';
    const modelNames = (count: number) => Array.from({ length: count }, (_, index) => `acct/model-${String(index)}`);

    it('starts empty, which allows no model', async () => {
      const { router, store } = await createRouter();

      expect(await (await router.request('/')).json()).toMatchObject({
        data: { manifest: { auto_model_routing: { enabled: true, allowed_models: [] } } },
      });
      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing).toEqual({ enabled: true, allowed_models: [] });
    });

    it('PATCH saves the list, dropping duplicates, and a later GET reads it back', async () => {
      const { router } = await createRouter();

      const patched = await router.request(
        '/',
        patchInit({ auto_model_routing: { allowed_models: [sonnet, haiku, sonnet] } }),
      );
      expect(patched.status).toBe(200);

      expect(await (await router.request('/')).json()).toMatchObject({
        data: { manifest: { auto_model_routing: { enabled: true, allowed_models: [sonnet, haiku] } } },
      });
    });

    it('PATCH of the switch alone keeps the saved list', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { allowed_models: [sonnet] } }));

      const patched = await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));
      expect(patched.status).toBe(200);

      await expect(store.getConfiguration(tenantId)).resolves.toMatchObject({
        manifest: { auto_model_routing: { enabled: false, allowed_models: [sonnet] } },
      });
    });

    it('PATCH of the list alone keeps the switch', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));

      await router.request('/', patchInit({ auto_model_routing: { allowed_models: [sonnet] } }));

      await expect(store.getConfiguration(tenantId)).resolves.toMatchObject({
        manifest: { auto_model_routing: { enabled: false, allowed_models: [sonnet] } },
      });
    });

    it('PATCH with an empty list removes every model', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { allowed_models: [sonnet] } }));

      const patched = await router.request('/', patchInit({ auto_model_routing: { allowed_models: [] } }));
      expect(patched.status).toBe(200);

      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing).toEqual({ enabled: true, allowed_models: [] });
    });

    it('PATCH accepts ten models and rejects eleven', async () => {
      const { router, store } = await createRouter();

      const ten = await router.request('/', patchInit({ auto_model_routing: { allowed_models: modelNames(10) } }));
      expect(ten.status).toBe(200);
      const eleven = await router.request('/', patchInit({ auto_model_routing: { allowed_models: modelNames(11) } }));
      expect(eleven.status).toBe(400);

      const record = await store.getConfiguration(tenantId);
      expect(record?.manifest.auto_model_routing.allowed_models).toEqual(modelNames(10));
    });

    it.each(['', 'sonnet', '/sonnet', 'acct/', 'acct/team/sonnet'])(
      'PATCH rejects "%s" as a model name',
      async name => {
        const { router } = await createRouter();

        const patched = await router.request('/', patchInit({ auto_model_routing: { allowed_models: [name] } }));
        expect(patched.status).toBe(400);
      },
    );

    it('PATCH rejects null for the list', async () => {
      const { router } = await createRouter();

      const patched = await router.request('/', patchInit({ auto_model_routing: { allowed_models: null } }));
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
    const { store } = await createRouter();
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
            auto_model_routing: { enabled: true, allowed_models: [] },
          },
        });
        return await store.getOrCreateConfiguration(input);
      },
      listTenantIdsWithFeatureEnabled: feature => store.listTenantIdsWithFeatureEnabled(feature),
    };
    const router = createConfigurationRouter({
      resolveConfigurationStore: () => racingStore,
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
      auto_model_routing: { enabled: true, allowed_models: [] },
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
