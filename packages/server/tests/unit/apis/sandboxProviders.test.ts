import { createSandboxProvidersRouter } from '../../../src/apis/sandboxProviders';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';

const putBody = {
  type: 'daytona' as const,
  snapshot_name: 'truefoundry-platform-dev-2d5edee',
  auth: { api_key: 'dtn-test' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('sandboxProviders router', () => {
  let settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    settingsRouter = createSandboxProvidersRouter({
      sandboxCatalog: SandboxCatalog.load(),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
    });
  });

  it('GET /catalog returns the shipped catalog verbatim', async () => {
    const response = await settingsRouter.request('/catalog');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [...SandboxCatalog.load().list()] });
  });

  it('GET / returns 404 when none configured', async () => {
    const response = await settingsRouter.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No sandbox provider configured' } });
  });

  it('PUT upserts the singleton provider and GET returns it', async () => {
    const put = await settingsRouter.request('/', putInit(putBody));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ data: putBody });

    const get = await settingsRouter.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ data: putBody });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { auth: _, ...withoutAuth } = putBody;
    const missingAuth = await settingsRouter.request('/', putInit(withoutAuth));
    expect(missingAuth.status).toBe(400);

    const badType = await settingsRouter.request('/', putInit({ ...putBody, type: 'unknown' }));
    expect(badType.status).toBe(400);
  });
});
