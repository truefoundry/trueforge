import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';

describe('capabilities routers', () => {
  it('capabilities derive sandbox and skill from the store', async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const store = new SqliteSandboxProviderStore(db);
    const router = createCapabilitiesRouter({ sandboxProviderStore: store });

    const empty = await router.request('/');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      data: {
        sandbox: { enabled: false },
        skill: {
          enabled: false,
          reason: 'Skills run in a sandbox, which is not configured.',
        },
        settings: { enabled: true },
      },
    });

    await store.upsertSandboxProvider({
      tenant_id: 'default',
      manifest: {
        type: 'daytona',
        snapshot_name: 'trueforge-local',
        auth: { api_key: 'dtn-test' },
        exec_timeout_ms: 60000,
        auto_stop_interval_in_minutes: 5,
        auto_archive_interval_in_minutes: 60,
        auto_delete_interval_in_minutes: 7200,
      },
    });

    const configured = await router.request('/');
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
      },
    });
  });
});
