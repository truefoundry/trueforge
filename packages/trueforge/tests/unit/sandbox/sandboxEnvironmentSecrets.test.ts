import { DaytonaError } from '@daytona/sdk';
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
      logger,
    });
    const buildRouter = createSandboxEnvironmentBuildRouter({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      logger,
    });
    const putEnvironment = (manifest: unknown) =>
      publicRouter.request('/', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest }),
      });
    return { publicRouter, buildRouter, sandboxEnvironmentStore, putEnvironment };
  }

  it('upserts secret rows and syncs to Daytona on PUT, redacts, and mounts names after ready', async () => {
    const { buildRouter, sandboxEnvironmentStore, putEnvironment } = await setup();

    const createSecret = jest
      .fn()
      .mockImplementation(({ name }: { name: string }) => Promise.resolve({ id: 'daytona-sec-1', name }));
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      getBuildStatus: jest.fn().mockResolvedValue({ status: 'ready', reason: null, metadata: null }),
      build: jest.fn(),
      createSecret,
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
    } as never);

    const putRes = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      data: {
        id: string;
        status: string;
        manifest: { networking?: { secrets?: { value: string }[] } };
      };
    };
    expect(putBody.data.status).toBe('pending');
    expect(putBody.data.manifest.networking?.secrets?.[0]?.value).toBe(SECRET_REDACTION);

    const rows = await sandboxEnvironmentStore.listSecretsByEnvironment({
      environment_id: putBody.data.id,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        secret_name: 'GITHUB_TOKEN',
        external_secret_id: 'daytona-sec-1',
        external_secret_name: expect.stringMatching(/^trueforge-/),
      }),
    ]);
    expect(createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: rows[0]?.external_secret_name,
        value: 'ghp_plain',
        hosts: ['github.com'],
      }),
    );

    const pendingAfterPut = await sandboxEnvironmentStore.getEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'secret-env',
      created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
    expect(pendingAfterPut?.version.manifest.networking?.secrets?.[0]?.value).toBe(SECRET_REDACTION);

    const pending = (await (await buildRouter.request('/pending')).json()) as {
      data: { environment_version_id: string }[];
    };
    const versionId = pending.data[0]?.environment_version_id;
    expect(versionId).toBeDefined();

    expect(
      (
        await buildRouter.request('/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ environment_version_id: versionId }),
        })
      ).status,
    ).toBe(204);

    expect(createSecret).toHaveBeenCalledTimes(1);

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

  it('updates a redacted secret and removes its Daytona and database refs on PUT', async () => {
    const { sandboxEnvironmentStore, putEnvironment } = await setup();
    const createSecret = jest
      .fn()
      .mockImplementation(({ name }: { name: string }) => Promise.resolve({ id: 'daytona-sec-1', name }));
    const updateSecret = jest.fn().mockResolvedValue(undefined);
    const deleteSecret = jest.fn().mockResolvedValue(undefined);
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret,
      updateSecret,
      deleteSecret,
    } as never);

    const createResponse = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { data: { id: string } };
    const originalRows = await sandboxEnvironmentStore.listSecretsByEnvironment({
      environment_id: created.data.id,
    });

    const unchangedResponse = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: SECRET_REDACTION, hosts: ['github.com'] }],
      },
    });
    expect(unchangedResponse.status).toBe(200);
    expect(updateSecret).not.toHaveBeenCalled();

    const updateResponse = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: SECRET_REDACTION, hosts: ['api.github.com'] }],
      },
    });
    expect(updateResponse.status).toBe(200);
    expect(updateSecret).toHaveBeenCalledWith({
      secretId: 'daytona-sec-1',
      hosts: ['api.github.com'],
    });
    expect(await sandboxEnvironmentStore.listSecretsByEnvironment({ environment_id: created.data.id })).toEqual([
      expect.objectContaining({
        id: originalRows[0]?.id,
        hash: originalRows[0]?.hash,
        external_secret_name: originalRows[0]?.external_secret_name,
        external_secret_id: 'daytona-sec-1',
      }),
    ]);

    const removeResponse = await putEnvironment({ name: 'secret-env' });
    expect(removeResponse.status).toBe(200);
    expect(deleteSecret).toHaveBeenCalledWith({ secretId: 'daytona-sec-1' });
    expect(await sandboxEnvironmentStore.listSecretsByEnvironment({ environment_id: created.data.id })).toEqual([]);
  });

  it('deletes Daytona secrets and secret rows when deleting an environment', async () => {
    const { publicRouter, sandboxEnvironmentStore, putEnvironment } = await setup();
    const deleteSecret = jest.fn().mockResolvedValue(undefined);
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret: jest.fn().mockResolvedValue({ id: 'daytona-sec-1', name: 'trueforge-secret-1' }),
      updateSecret: jest.fn(),
      deleteSecret,
    } as never);

    const createResponse = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });
    const created = (await createResponse.json()) as { data: { id: string } };

    const deleteResponse = await publicRouter.request('/secret-env', { method: 'DELETE' });

    expect(deleteResponse.status).toBe(200);
    expect(deleteSecret).toHaveBeenCalledWith({ secretId: 'daytona-sec-1' });
    expect(await sandboxEnvironmentStore.listSecretsByEnvironment({ environment_id: created.data.id })).toEqual([]);
    expect(
      await sandboxEnvironmentStore.getEnvironment({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        name: 'secret-env',
        created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
      }),
    ).toBeUndefined();
  });

  it('keeps the environment when Daytona secret deletion fails', async () => {
    const { publicRouter, sandboxEnvironmentStore, putEnvironment } = await setup();
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret: jest.fn().mockResolvedValue({ id: 'daytona-sec-1', name: 'trueforge-secret-1' }),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn().mockRejectedValue(new Error('Daytona secret delete failed')),
    } as never);

    await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });

    const deleteResponse = await publicRouter.request('/secret-env', { method: 'DELETE' });

    expect(deleteResponse.status).toBe(502);
    expect(await deleteResponse.json()).toEqual({
      error: { message: 'Daytona secret delete failed' },
    });
    expect(
      await sandboxEnvironmentStore.getEnvironment({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        name: 'secret-env',
        created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
      }),
    ).toBeDefined();
  });

  it('returns 502 when Daytona secret sync fails on PUT', async () => {
    const { sandboxEnvironmentStore, putEnvironment } = await setup();

    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret: jest.fn().mockRejectedValue(new Error('Daytona secret create failed')),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
    } as never);

    const putRes = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });
    expect(putRes.status).toBe(502);
    expect(await putRes.json()).toEqual({
      error: { message: 'Daytona secret create failed' },
    });

    const loaded = await sandboxEnvironmentStore.getEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'secret-env',
      created_by_subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
    expect(loaded).toBeUndefined();
  });

  it('returns 422 when Daytona rejects the provider credentials', async () => {
    const { putEnvironment } = await setup();

    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      createSecret: jest.fn().mockRejectedValue(new DaytonaError('Unauthorized', 401)),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
    } as never);

    const putRes = await putEnvironment({
      name: 'secret-env',
      networking: {
        secrets: [{ env: 'GITHUB_TOKEN', value: 'ghp_plain', hosts: ['github.com'] }],
      },
    });

    expect(putRes.status).toBe(422);
    expect(await putRes.json()).toEqual({
      error: { message: 'Sandbox provider rejected the API key — check the credentials' },
    });
  });
});
