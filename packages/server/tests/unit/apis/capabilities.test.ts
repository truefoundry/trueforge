import { createCapabilitiesRouter } from '../../../src/apis/capabilities';
import { createLegacyCapabilitiesRouter } from '../../../src/apis/legacyCapabilities';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';

describe('capabilities routers', () => {
  it('legacy capabilities report boot-time sandboxEnabled', async () => {
    const enabled = createLegacyCapabilitiesRouter({ sandboxEnabled: true });
    const enabledRes = await enabled.request('/');
    expect(enabledRes.status).toBe(200);
    expect(await enabledRes.json()).toEqual({ data: { sandbox: { enabled: true } } });

    const disabled = createLegacyCapabilitiesRouter({ sandboxEnabled: false });
    const disabledRes = await disabled.request('/');
    expect(disabledRes.status).toBe(200);
    expect(await disabledRes.json()).toEqual({ data: { sandbox: { enabled: false } } });
  });

  it('new capabilities derive sandbox and skill from the store', async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const store = new SqliteSandboxProviderStore(db);
    const router = createCapabilitiesRouter({ sandboxProviderStore: store });

    const empty = await router.request('/');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      data: { sandbox: { enabled: false }, skill: { enabled: false } },
    });

    await store.upsertSandboxProvider({
      tenant_id: 'default',
      manifest: {
        type: 'daytona',
        snapshot_name: 'truefoundry-platform-dev-2d5edee',
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
      data: { sandbox: { enabled: true }, skill: { enabled: true } },
    });
  });
});
