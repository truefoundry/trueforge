import { createLogger } from 'winston';
import { createSandboxEnvironmentBuildRouter } from '../../../src/apis/sandboxEnvironmentBuild';
import { createSandboxEnvironmentsRouter } from '../../../src/apis/sandboxEnvironments';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { resolveSandboxEnvironment } from '../../../src/runtime/sessionResources';
import * as providerUtils from '../../../src/sandbox/providerUtils';
import { SECRET_REDACTION } from '../../../src/utils/secretRedaction';

jest.mock('../../../src/sandbox/providerUtils', () => {
  const actual = jest.requireActual<typeof import('../../../src/sandbox/providerUtils')>(
    '../../../src/sandbox/providerUtils',
  );
  return { ...actual, toDaytonaSandboxProvider: jest.fn() };
});

const logger = createLogger({ silent: true });

const daytonaManifest = {
  type: 'daytona' as const,
  auth: { api_key: 'dtn-test-secret' },
  exec_timeout_ms: 60_000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

describe('sandbox environment secrets', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function setup() {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const sandboxEnvironmentStore = new SqliteSandboxEnvironmentStore(db);
    const sandboxProviderStore = new SqliteSandboxProviderStore(db);
    await sandboxProviderStore.upsertSandboxProvider({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: daytonaManifest,
    });
    const publicRouter = createSandboxEnvironmentsRouter({
      sandboxEnvironmentStore,
      resolveAgentStore: () => ({ listAgentNamesUsingSandboxEnvironment: jest.fn().mockResolvedValue([]) }) as never,
      resolveSandboxProviderStore: () => sandboxProviderStore,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    const buildRouter = createSandboxEnvironmentBuildRouter({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      logger,
    });
    return { publicRouter, buildRouter, sandboxEnvironmentStore };
  }

  it('upserts secret rows on PUT, syncs to Daytona on progress, redacts, and mounts names', async () => {
    const { publicRouter, buildRouter, sandboxEnvironmentStore } = await setup();

    const putRes = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'secret-env',
          networking: {
            secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
          },
        },
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { data: { id: string; status: string } };
    expect(putBody.data.status).toBe('pending');

    const rows = await sandboxEnvironmentStore.listSecretsByEnvironment({
      environment_id: putBody.data.id,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        secret_name: 'GITHUB_TOKEN',
        external_secret_id: null,
        external_secret_name: expect.stringMatching(/^trueforge-/),
      }),
    ]);

    const pending = (await (await buildRouter.request('/pending')).json()) as {
      data: { environment_version_id: string }[];
    };
    const versionId = pending.data[0]?.environment_version_id;
    expect(versionId).toBeDefined();

    const createSecret = jest.fn().mockResolvedValue({
      id: 'daytona-sec-1',
      name: rows[0]?.external_secret_name,
    });
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      getBuildStatus: jest.fn().mockResolvedValue({ status: 'ready', reason: null, metadata: null }),
      build: jest.fn(),
      createSecret,
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
    } as never);

    expect(
      (
        await buildRouter.request('/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ environment_version_id: versionId }),
        })
      ).status,
    ).toBe(204);

    expect(createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: rows[0]?.external_secret_name,
        value: 'ghp_plain',
        hosts: ['github.com'],
      }),
    );

    const loaded = await sandboxEnvironmentStore.getEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'secret-env',
      created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
    expect(loaded?.version.status).toBe('ready');
    expect(loaded?.version.manifest.networking?.secrets?.[0]?.value).toBe(SECRET_REDACTION);
    expect(loaded?.mounted_secrets).toEqual({
      GITHUB_TOKEN: rows[0]?.external_secret_name,
    });

    const environment = await resolveSandboxEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'secret-env',
      sandboxEnvironmentStore,
    });
    expect(environment?.mounted_secrets).toEqual({
      GITHUB_TOKEN: rows[0]?.external_secret_name,
    });
  });

  it('marks the version failed when Daytona secret sync fails', async () => {
    const { publicRouter, buildRouter, sandboxEnvironmentStore } = await setup();

    await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'secret-env',
          networking: {
            secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
          },
        },
      }),
    });
    const pending = (await (await buildRouter.request('/pending')).json()) as {
      data: { environment_version_id: string }[];
    };

    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      getBuildStatus: jest.fn().mockResolvedValue({ status: 'ready', reason: null, metadata: null }),
      build: jest.fn(),
      createSecret: jest.fn().mockRejectedValue(new Error('Daytona secret create failed')),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
    } as never);

    expect(
      (
        await buildRouter.request('/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ environment_version_id: pending.data[0]?.environment_version_id }),
        })
      ).status,
    ).toBe(204);

    const loaded = await sandboxEnvironmentStore.getEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'secret-env',
      created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
    expect(loaded?.version.status).toBe('failed');
    expect(loaded?.version.status_reason).toBe('Daytona secret create failed');
  });
});
