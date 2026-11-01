import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { CreateSandboxEnvironmentInput } from '../../../src/db/sandboxEnvironmentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { NameSchema } from '../../../src/schemas/common';
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
const SNAPSHOT = 'trueforge-default-default';

function mockSnapshot(snapshotName: string): void {
  mockResolveConfig.mockReturnValue({
    type: 'daytona',
    apiKey: 'dtn-shared',
    settings: {
      snapshotName,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 43_200,
      timeoutMs: 60_000,
    },
  });
}

function customEnvironmentInput(name: string): CreateSandboxEnvironmentInput {
  const created_by_subject = {
    subject_id: SUBJECT_ID,
    subject_type: 'user',
    subject_display_name: 'User',
  };
  return {
    tenant_id: TENANT,
    name: NameSchema.parse(name),
    description: '',
    created_by_subject,
    synced_secrets: [],
    buildVersion: () =>
      Promise.resolve({
        version: 1,
        manifest: {
          name: NameSchema.parse(name),
          resources: { cpu: 1, memory: 1, disk: 3 },
          type: 'daytona' as const,
          sandbox_provider: 'daytona' as const,
        },
        status: 'pending' as const,
        status_reason: null,
        external_ref: 'ref-1',
        created_by_subject,
      }),
  };
}

describe('TrueFoundrySandboxEnvironmentStore', () => {
  beforeEach(() => {
    mockResolveConfig.mockReset();
    mockSnapshot(SNAPSHOT);
  });

  async function createStores(envSupported: boolean) {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const persistence = new SqliteSandboxEnvironmentStore(db);
    const store = new TrueFoundrySandboxEnvironmentStore(persistence, { envSupported });
    return { store, persistence };
  }

  it('creates the default environment on first read, pinned to the configured snapshot', async () => {
    const { store, persistence } = await createStores(true);

    await expect(
      persistence.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }),
    ).resolves.toBeUndefined();

    const loaded = await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    expect(loaded?.version.status).toBe('ready');
    expect(loaded?.version.external_ref).toBe(SNAPSHOT);
    // Persisted, not synthesized.
    await expect(
      persistence.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }),
    ).resolves.toMatchObject({ environment: { id: loaded?.environment.id } });
  });

  it('reuses the existing default row on later reads', async () => {
    const { store } = await createStores(true);

    const first = await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });
    const second = await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    expect(second?.environment.id).toBe(first?.environment.id);
    expect(second?.version.version).toBe(1);
  });

  it('advances the default onto a new snapshot when the configured one changes', async () => {
    const { store } = await createStores(true);
    await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    mockSnapshot('trueforge-default-v2');
    const loaded = await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    expect(loaded?.version.external_ref).toBe('trueforge-default-v2');
    expect(loaded?.version.status).toBe('ready');
    expect(loaded?.version.version).toBe(2);
  });

  it('never queues the default for a snapshot build', async () => {
    const { store, persistence } = await createStores(true);
    await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    await expect(persistence.listLatestPendingVersions()).resolves.toEqual([]);
  });

  it('lists the default alongside custom environments exactly once', async () => {
    const { store, persistence } = await createStores(true);
    await persistence.upsertEnvironment(customEnvironmentInput('pyjokes-env'));

    const listed = await store.listEnvironments({ tenant_id: TENANT, limit: 25, page_token: undefined });

    expect(listed.data.map(row => row.environment.name)).toEqual([DEFAULT_SANDBOX_ENVIRONMENT_NAME, 'pyjokes-env']);
    expect(listed.data[0]?.version.status).toBe('ready');
  });

  it('no-ops get/list when env is not supported', async () => {
    const { store } = await createStores(false);

    await expect(
      store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }),
    ).resolves.toBeUndefined();

    const listed = await store.listEnvironments({ tenant_id: TENANT, limit: 25, page_token: undefined });
    expect(listed.data).toEqual([]);
  });

  it('getEnvironmentsByIds returns the persisted default ownership when envSupported', async () => {
    const { store, persistence } = await createStores(true);
    const custom = await persistence.upsertEnvironment(customEnvironmentInput('pyjokes-env'));
    const defaultEnv = await store.getEnvironment({ tenant_id: TENANT, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME });

    await expect(
      store.getEnvironmentsByIds({
        tenant_id: TENANT,
        ids: [String(defaultEnv?.environment.id), custom.environment.id, 'missing'],
      }),
    ).resolves.toEqual([
      {
        id: defaultEnv?.environment.id,
        name: DEFAULT_SANDBOX_ENVIRONMENT_NAME,
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
    ]);
  });
});
