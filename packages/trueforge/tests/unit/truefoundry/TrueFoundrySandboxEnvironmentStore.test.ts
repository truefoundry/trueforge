import { isTrueFoundryModeEnabled } from '../../../src/config';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ISandboxEnvironmentStore } from '../../../src/db/sandboxEnvironmentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { RESERVED_SANDBOX_ENVIRONMENT_NAME } from '../../../src/schemas/sandboxEnvironment';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';
import { TrueFoundrySandboxEnvironmentStore } from '../../../src/truefoundry/TrueFoundrySandboxEnvironmentStore';

jest.mock('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig', () => {
  const actual = jest.requireActual('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig');
  return {
    ...actual,
    resolveTrueFoundrySandboxProviderConfig: jest.fn(),
  };
});

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    __esModule: true,
    ...actual,
    isTrueFoundryModeEnabled: jest.fn(() => true),
  };
});

const mockResolveConfig = resolveTrueFoundrySandboxProviderConfig as jest.MockedFunction<
  typeof resolveTrueFoundrySandboxProviderConfig
>;

const TENANT = 'acme';
const SUBJECT_ID = 'user-1';

function addCustomEnvironment(store: ISandboxEnvironmentStore, name: string) {
  const created_by_subject = {
    subject_id: SUBJECT_ID,
    subject_type: 'user' as const,
    subject_display_name: 'User',
  };
  return store.upsertEnvironment({
    tenant_id: TENANT,
    name,
    description: '',
    created_by_subject,
    synced_secrets: [],
    buildVersion: () =>
      Promise.resolve({
        version: 1,
        manifest: {
          name,
          resources: { cpu: 1, memory: 1, disk: 3 },
          type: 'truefoundry' as const,
          sandbox_provider: 'daytona' as const,
        },
        status: 'pending' as const,
        status_reason: null,
        external_ref: 'ref-1',
        created_by_subject,
      }),
  });
}

describe('TrueFoundrySandboxEnvironmentStore', () => {
  beforeEach(() => {
    mockResolveConfig.mockReset();
    mockResolveConfig.mockReturnValue({
      type: 'daytona',
      apiKey: 'dtn-shared',
      settings: {
        snapshotName: 'trueforge-default-default',
        autoStopIntervalInMinutes: 5,
        autoArchiveIntervalInMinutes: 60,
        autoDeleteIntervalInMinutes: 43_200,
        timeoutMs: 60_000,
      },
    });
  });

  async function createStores(envSupported: boolean) {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const persistence = new SqliteSandboxEnvironmentStore(db);
    const store = new TrueFoundrySandboxEnvironmentStore(persistence, { envSupported });
    return { db, store, persistence };
  }

  it('materializes an always-ready default flagged as the tenant default when envSupported', async () => {
    const { store, persistence } = await createStores(true);

    const loaded = await store.getEnvironment({
      tenant_id: TENANT,
      name: RESERVED_SANDBOX_ENVIRONMENT_NAME,
    });

    expect(loaded?.version.status).toBe('ready');
    expect(loaded?.version.external_ref).toBe('trueforge-default-default');
    expect(loaded?.environment.name).toBe(RESERVED_SANDBOX_ENVIRONMENT_NAME);
    expect(loaded?.environment.is_default).toBe(true);
    expect(loaded?.environment.enabled).toBe(true);
    expect(loaded?.version.manifest).toMatchObject({ type: 'truefoundry', sandbox_provider: 'daytona' });
    expect(isTrueFoundryModeEnabled).toHaveBeenCalled();

    // The row is real, so a plain persistence read finds it.
    const persisted = await persistence.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    expect(persisted?.environment.id).toBe(loaded?.environment.id);
  });

  it('is idempotent when the tip is current and advances it when snapshotName changes', async () => {
    const { store, persistence } = await createStores(true);
    const upsert = jest.spyOn(persistence, 'upsertEnvironment');

    const first = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    await store.listEnvironments({ tenant_id: TENANT, limit: 25, page_token: undefined });
    const second = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    expect(second?.environment.id).toBe(first?.environment.id);
    expect(second?.version.version).toBe(first?.version.version);
    expect(upsert).toHaveBeenCalledTimes(1);

    mockResolveConfig.mockReturnValue({
      type: 'daytona',
      apiKey: 'dtn-shared',
      settings: {
        snapshotName: 'trueforge-default-next',
        autoStopIntervalInMinutes: 5,
        autoArchiveIntervalInMinutes: 60,
        autoDeleteIntervalInMinutes: 43_200,
        timeoutMs: 60_000,
      },
    });
    const advanced = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    expect(advanced?.environment.id).toBe(first?.environment.id);
    expect(advanced?.version.external_ref).toBe('trueforge-default-next');
    expect(advanced?.version.status).toBe('ready');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('retries provisioning after a failed pass', async () => {
    const { store, persistence } = await createStores(true);
    const upsert = jest
      .spyOn(persistence, 'upsertEnvironment')
      .mockRejectedValueOnce(new Error('snapshot write failed'));

    await expect(store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME })).rejects.toThrow(
      'snapshot write failed',
    );

    const loaded = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    expect(loaded?.version.external_ref).toBe('trueforge-default-default');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('lists the default alongside custom environments', async () => {
    const { store, persistence } = await createStores(true);
    await addCustomEnvironment(persistence, 'pyjokes-env');

    const listed = await store.listEnvironments({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
    });

    expect(listed.data.map(row => row.environment.name).sort()).toEqual([
      RESERVED_SANDBOX_ENVIRONMENT_NAME,
      'pyjokes-env',
    ]);
    expect(listed.data.find(row => row.environment.name === RESERVED_SANDBOX_ENVIRONMENT_NAME)?.version.status).toBe(
      'ready',
    );
  });

  it('leaves an admin-chosen default in place', async () => {
    const { store, persistence } = await createStores(true);
    await addCustomEnvironment(persistence, 'pyjokes-env');
    await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'pyjokes-env' });

    const loaded = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });
    expect(loaded?.environment.is_default).toBe(false);
    await expect(store.getDefaultEnvironment({ tenant_id: TENANT })).resolves.toMatchObject({
      environment: { name: 'pyjokes-env', is_default: true },
    });
  });

  it('no-ops get/list when env is not supported', async () => {
    const { store } = await createStores(false);

    await expect(
      store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME }),
    ).resolves.toBeUndefined();
    await expect(store.getDefaultEnvironment({ tenant_id: TENANT })).resolves.toBeUndefined();
    await expect(store.hasUsableEnvironment({ tenant_id: TENANT })).resolves.toBe(false);

    const listed = await store.listEnvironments({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
    });
    expect(listed.data).toEqual([]);
  });

  it('getEnvironmentsByIds resolves the reserved row ownership', async () => {
    const { store, persistence } = await createStores(true);
    const custom = await addCustomEnvironment(persistence, 'pyjokes-env');
    const reservedEnv = await store.getEnvironment({ tenant_id: TENANT, name: RESERVED_SANDBOX_ENVIRONMENT_NAME });

    await expect(
      store.getEnvironmentsByIds({
        tenant_id: TENANT,
        ids: [reservedEnv?.environment.id ?? '', custom.environment.id, 'missing'],
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          id: reservedEnv?.environment.id,
          name: RESERVED_SANDBOX_ENVIRONMENT_NAME,
          created_by_subject: {
            subject_id: 'truefoundry',
            subject_type: 'user',
            subject_display_name: 'TrueFoundry',
          },
        },
        {
          id: custom.environment.id,
          name: 'pyjokes-env',
          created_by_subject: {
            subject_id: SUBJECT_ID,
            subject_type: 'user',
            subject_display_name: 'User',
          },
        },
      ]),
    );
  });
});
