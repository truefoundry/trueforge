import { createConfigurationsRouter } from '../../../src/apis/configurations';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
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
  const router = createConfigurationsRouter({
    resolveConfigurationStore: () => store,
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  return { router, store };
}

describe('settings configurations router', () => {
  it('GET reports everything enabled and materialises the row on first read', async () => {
    const { router, store } = await createRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { manifest: { web_search: { enabled: true } }, updated_at: expect.any(String) },
    });
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: { web_search: { enabled: true } },
      updated_at: expect.any(String),
    });
  });

  it('PATCH saves the switches and a later GET reads them back', async () => {
    const { router } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false } } },
    });

    const get = await router.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false } } },
    });
  });

  it('PATCH on a tenant with nothing saved starts from the defaults', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false } },
    });
  });

  it('PATCH can turn web search back on', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const reEnabled = await router.request('/', patchInit({ web_search: { enabled: true } }));
    expect(reEnabled.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: true } },
    });
  });

  it('PATCH leaves switches the body does not mention', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const empty = await router.request('/', patchInit({}));
    expect(empty.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false } },
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
