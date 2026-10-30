import { createTenantSettingsRouter } from '../../../src/apis/tenantSettings';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteTenantSettingStore } from '../../../src/db/sqlite/tenant-setting-store/SqliteTenantSettingStore';

function putInit(manifest: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  };
}

async function createRouter() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const store = new SqliteTenantSettingStore(db);
  const router = createTenantSettingsRouter({
    resolveTenantSettingStore: () => store,
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  return { router, store };
}

describe('settings tenant-settings router', () => {
  it('GET reports everything enabled and writes no row when the tenant has nothing saved', async () => {
    const { router, store } = await createRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { manifest: { web_search: { enabled: true } } },
    });
    await expect(store.getTenantSetting(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toBeUndefined();
  });

  it('PUT saves the switches and a later GET reads them back', async () => {
    const { router } = await createRouter();

    const put = await router.request('/', putInit({ web_search: { enabled: false } }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      data: { manifest: { web_search: { enabled: false } } },
    });

    const get = await router.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      data: { manifest: { web_search: { enabled: false } } },
    });
  });

  it('PUT replaces the single row so web search can be turned back on', async () => {
    const { router, store } = await createRouter();

    await router.request('/', putInit({ web_search: { enabled: false } }));
    const reEnabled = await router.request('/', putInit({ web_search: { enabled: true } }));
    expect(reEnabled.status).toBe(200);

    await expect(store.getTenantSetting(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: { web_search: { enabled: true } },
    });
  });

  it('PUT rejects a manifest that is missing a switch', async () => {
    const { router } = await createRouter();
    const put = await router.request('/', putInit({}));
    expect(put.status).toBe(400);
  });

  it('PUT rejects a switch the server does not know about', async () => {
    const { router } = await createRouter();
    const put = await router.request('/', putInit({ web_search: { enabled: true }, sandbox: { enabled: false } }));
    expect(put.status).toBe(400);
  });
});
