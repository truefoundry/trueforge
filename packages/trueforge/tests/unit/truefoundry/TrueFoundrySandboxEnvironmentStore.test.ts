import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../../../src/schemas/sandboxEnvironment';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';
import { TrueFoundrySandboxEnvironmentStore } from '../../../src/truefoundry/TrueFoundrySandboxEnvironmentStore';

jest.mock('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig', () => {
  const actual = jest.requireActual('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig');
  return {
    ...actual,
    resolveTrueFoundrySandboxProviderConfig: jest.fn(),
  };
});

const mockResolveConfig = resolveTrueFoundrySandboxProviderConfig as jest.MockedFunction<
  typeof resolveTrueFoundrySandboxProviderConfig
>;

const TENANT = 'acme';
const SUBJECT_ID = 'user-1';

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
    return { store, persistence };
  }

  it('synthesizes always-ready default when envSupported', async () => {
    const { store } = await createStores(true);

    const loaded = await store.getEnvironment({
      tenant_id: TENANT,
      name: DEFAULT_SANDBOX_ENVIRONMENT_NAME,
    });

    expect(loaded?.version.status).toBe('ready');
    expect(loaded?.version.external_ref).toBe('trueforge-default-default');
    expect(loaded?.environment.name).toBe(DEFAULT_SANDBOX_ENVIRONMENT_NAME);
  });

  it('lists synthesized default ahead of custom environments', async () => {
    const { store, persistence } = await createStores(true);
    await persistence.upsertEnvironment({
      tenant_id: TENANT,
      name: 'pyjokes-env',
      description: '',
      created_by_subject: {
        subject_id: SUBJECT_ID,
        subject_type: 'user',
        subject_display_name: 'User',
      },
      buildVersion: () => ({
        version: 1,
        manifest: {
          name: 'pyjokes-env',
          resources: { cpu: 1, memory: 1, disk: 3 },
          type: 'daytona',
          sandbox_provider: 'daytona',
        },
        status: 'pending',
        status_reason: null,
        external_ref: 'ref-1',
        internal_metadata: { secrets: [] },
        created_by_subject: {
          subject_id: SUBJECT_ID,
          subject_type: 'user',
          subject_display_name: 'User',
        },
      }),
    });

    const listed = await store.listEnvironments({
      tenant_id: TENANT,
      created_by_subject_id: SUBJECT_ID,
      limit: 25,
      page_token: undefined,
    });

    expect(listed.data.map(row => row.environment.name)).toEqual([DEFAULT_SANDBOX_ENVIRONMENT_NAME, 'pyjokes-env']);
    expect(listed.data[0]?.version.status).toBe('ready');
  });

  it('no-ops get/list inject when env is not supported', async () => {
    const { store } = await createStores(false);

    await expect(
      store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }),
    ).resolves.toBeUndefined();

    const listed = await store.listEnvironments({
      tenant_id: TENANT,
      created_by_subject_id: SUBJECT_ID,
      limit: 25,
      page_token: undefined,
    });
    expect(listed.data).toEqual([]);
  });
});
