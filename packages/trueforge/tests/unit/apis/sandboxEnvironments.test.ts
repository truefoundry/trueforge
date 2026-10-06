import { DAYTONA_SNAPSHOT_NOT_STARTED_REASON } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { createSandboxEnvironmentBuildRouter } from '../../../src/apis/sandboxEnvironmentBuild';
import { createSandboxEnvironmentsRouter } from '../../../src/apis/sandboxEnvironments';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import * as providerUtils from '../../../src/sandbox/providerUtils';

jest.mock('../../../src/sandbox/providerUtils', () => {
  const actual = jest.requireActual<typeof import('../../../src/sandbox/providerUtils')>(
    '../../../src/sandbox/providerUtils',
  );
  return {
    ...actual,
    toDaytonaSandboxProvider: jest.fn(),
  };
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

describe('sandbox environments API → build controller path', () => {
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
      resolveAgentStore: () =>
        ({
          listAgentNamesUsingSandboxEnvironment: jest.fn().mockResolvedValue([]),
        }) as never,
      resolveSandboxProviderStore: () => sandboxProviderStore,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
      logger,
    });
    const buildRouter = createSandboxEnvironmentBuildRouter({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      logger,
    });
    return { publicRouter, buildRouter, sandboxEnvironmentStore };
  }

  it('PUT custom env lands pending; internal progress marks ready after build', async () => {
    const { publicRouter, buildRouter, sandboxEnvironmentStore } = await setup();

    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn().mockResolvedValue({
        status: 'pending',
        reason: DAYTONA_SNAPSHOT_NOT_STARTED_REASON,
        metadata: null,
      }),
      build: jest.fn().mockResolvedValue({
        status: 'ready',
        reason: null,
        metadata: null,
      }),
    } as never);

    const putRes = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'pyjokes-env',
          description: 'has pyjokes',
          image: { type: 'build', build_script: 'pip install pyjokes' },
        },
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { data: { status: string; name: string } };
    expect(putBody.data).toMatchObject({ name: 'pyjokes-env', status: 'pending' });

    const pendingRes = await buildRouter.request('/pending');
    expect(pendingRes.status).toBe(200);
    const pendingBody = (await pendingRes.json()) as { data: { environment_version_id: string }[] };
    expect(pendingBody.data).toHaveLength(1);
    const versionId = pendingBody.data[0]?.environment_version_id;
    expect(versionId).toBeDefined();

    const progressRes = await buildRouter.request('/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment_version_id: versionId }),
    });
    expect(progressRes.status).toBe(204);

    const getRes = await publicRouter.request('/pyjokes-env');
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { data: { status: string } };
    expect(getBody.data.status).toBe('ready');

    const pendingAfter = await sandboxEnvironmentStore.listLatestPendingVersions();
    expect(pendingAfter).toEqual([]);

    const updateRes = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'pyjokes-env',
          description: 'has requests',
          image: { type: 'build', build_script: 'pip install requests' },
        },
      }),
    });
    expect(updateRes.status).toBe(200);

    const latestGetRes = await publicRouter.request('/pyjokes-env');
    const latestGetBody = (await latestGetRes.json()) as {
      data: { status: string; manifest: { image?: { build_script?: string } } };
    };
    expect(latestGetBody.data.status).toBe('pending');
    expect(latestGetBody.data.manifest.image?.build_script).toBe('pip install requests');

    const latestListBody = (await (await publicRouter.request('/')).json()) as {
      data: { status: string }[];
    };
    expect(latestListBody.data[0]?.status).toBe('pending');

    const active = await sandboxEnvironmentStore.getActiveEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'pyjokes-env',
      created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
    expect(active?.version.status).toBe('ready');
    expect(active?.version.manifest.image?.build_script).toBe('pip install pyjokes');
  });

  it('rejects creating the reserved default name', async () => {
    const { publicRouter } = await setup();
    const putRes = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: { name: 'default' },
      }),
    });
    expect(putRes.status).toBe(400);
  });

  it('lists environments for the caller without error when none exist yet', async () => {
    const { publicRouter } = await setup();
    const listRes = await publicRouter.request('/');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: unknown[] };
    expect(Array.isArray(listBody.data)).toBe(true);
  });
});
