import { createMemoryProvidersRouter } from '../../../src/apis/memoryProviders';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMemoryProviderStore } from '../../../src/db/sqlite/memory-provider-store/SqliteMemoryProviderStore';
import { toRedactedSecretValue } from '../../../src/utils/secretRedaction';

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
  const store = new SqliteMemoryProviderStore(db);
  const router = createMemoryProvidersRouter({
    resolveMemoryProviderStore: () => store,
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  return { router, store };
}

describe('settings memory-providers router', () => {
  it('GET returns 404 when none configured', async () => {
    const { router } = await createRouter();
    const response = await router.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No memory provider configured' } });
  });

  it('PUT without auth is rejected', async () => {
    const { router } = await createRouter();
    const put = await router.request('/', putInit({ type: 'zep' }));
    expect(put.status).toBe(400);
  });

  it('PUT with api_key upserts the singleton, redacts on response, and second PUT replaces the same row', async () => {
    const { router, store } = await createRouter();
    const apiKey = 'zep-secret-key';
    const created = await router.request(
      '/',
      putInit({ type: 'zep', server_url: 'https://zep.example.com/api/v4', auth: { api_key: apiKey } }),
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      data: {
        name: 'zep',
        manifest: {
          type: 'zep',
          server_url: 'https://zep.example.com/api/v4',
          auth: { api_key: toRedactedSecretValue(apiKey) },
        },
      },
    });

    const get = await router.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ data: { name: 'zep' } });

    const first = await store.getProvider('default');
    expect(first?.manifest.auth.api_key).toBe(apiKey);

    const rotated = await router.request('/', putInit({ type: 'zep', auth: { api_key: 'zep-rotated-key' } }));
    expect(rotated.status).toBe(200);

    const second = await store.getProvider('default');
    expect(second?.manifest.auth.api_key).toBe('zep-rotated-key');
    expect(second?.manifest.server_url).toBeUndefined();
    expect(second?.created_at).toBe(first?.created_at);
  });

  it('PUT with redacted api_key keeps the stored secret', async () => {
    const { router, store } = await createRouter();
    const apiKey = 'zep-keep-secret';
    await router.request('/', putInit({ type: 'zep', auth: { api_key: apiKey } }));

    const keep = await router.request('/', putInit({ type: 'zep', auth: { api_key: toRedactedSecretValue(apiKey) } }));
    expect(keep.status).toBe(200);
    expect((await store.getProvider('default'))?.manifest.auth.api_key).toBe(apiKey);
  });

  it('PUT rejects a server_url that is not a URL', async () => {
    const { router } = await createRouter();
    const put = await router.request('/', putInit({ type: 'zep', server_url: 'not a url', auth: { api_key: 'k' } }));
    expect(put.status).toBe(400);
  });
});
