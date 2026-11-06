import { DAYTONA_SNAPSHOT_NOT_STARTED_REASON } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { createSandboxEnvironmentBuildRouter } from '../../../src/apis/sandboxEnvironmentBuild';
import { createSandboxEnvironmentsRouter } from '../../../src/apis/sandboxEnvironments';
import type { RequestContext } from '../../../src/auth/identity';
import { STANDALONE_REQUEST_CONTEXT, TRUEFOUNDRY_TENANT_ADMIN_ROLE } from '../../../src/auth/identity';
import { getTrueForgeAuthMode, isTrueFoundryModeEnabled, TrueForgeAuthMode } from '../../../src/config';
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
    toSandboxProviderFromRecord: jest.fn(),
    toDaytonaSandboxProvider: jest.fn(),
  };
});

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    __esModule: true,
    ...actual,
    getTrueForgeAuthMode: jest.fn(() => actual.TrueForgeAuthMode.Standalone),
    isTrueFoundryModeEnabled: jest.fn(() => false),
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
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.Standalone);
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(false);
  });

  async function setup() {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    let requestContext: RequestContext = STANDALONE_REQUEST_CONTEXT;
    const sandboxEnvironmentStore = new SqliteSandboxEnvironmentStore(db);
    const sandboxProviderStore = new SqliteSandboxProviderStore(db);
    await sandboxProviderStore.upsertSandboxProvider({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: daytonaManifest,
    });

    // Runs between the delete handler's own checks and its store call — the race window.
    let duringDeletePreChecks: () => Promise<void> = () => Promise.resolve();
    const publicRouter = createSandboxEnvironmentsRouter({
      sandboxEnvironmentStore,
      resolveAgentStore: () =>
        ({
          listAgentNamesUsingSandboxEnvironment: jest.fn(async () => {
            await duringDeletePreChecks();
            return [];
          }),
        }) as never,
      resolveSandboxProviderStore: () => sandboxProviderStore,
      resolveRequestContext: () => requestContext,
      logger,
    });
    const buildRouter = createSandboxEnvironmentBuildRouter({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      logger,
    });
    return {
      db,
      publicRouter,
      buildRouter,
      sandboxEnvironmentStore,
      setDuringDeletePreChecks(hook: () => Promise<void>) {
        duringDeletePreChecks = hook;
      },
      setSubject(subjectId: string, roles: string[] = STANDALONE_REQUEST_CONTEXT.roles) {
        requestContext = {
          ...STANDALONE_REQUEST_CONTEXT,
          subject: { id: subjectId, type: 'user', display_name: subjectId },
          roles,
        };
      },
    };
  }

  it('PUT custom env lands pending; internal progress marks ready after build', async () => {
    const { publicRouter, buildRouter, sandboxEnvironmentStore } = await setup();

    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue({
      envSupported: true,
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
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      envSupported: true,
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

  it('POST creates an environment and returns 409 on name clash', async () => {
    const { publicRouter, sandboxEnvironmentStore } = await setup();
    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);

    const createBody = {
      manifest: {
        name: 'create-only-env',
        description: 'first',
        image: { type: 'build', build_script: 'pip install httpx' },
      },
    };
    const created = await publicRouter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; name: string; description: string };
    };
    expect(createdBody.data).toMatchObject({ name: 'create-only-env', description: 'first' });
    // jsonText projection so ParseJSONResultsPlugin parses created_by_subject (list-permissions path).
    await expect(
      sandboxEnvironmentStore.getEnvironmentsByIds({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        ids: [createdBody.data.id],
      }),
    ).resolves.toEqual([
      {
        id: createdBody.data.id,
        name: 'create-only-env',
        created_by_subject: {
          subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
          subject_type: STANDALONE_REQUEST_CONTEXT.subject.type,
          subject_display_name: STANDALONE_REQUEST_CONTEXT.subject.display_name,
        },
      },
    ]);

    const clash = await publicRouter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'create-only-env',
          description: 'overwrite attempt',
          image: { type: 'build', build_script: 'pip install requests' },
        },
      }),
    });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({
      error: { message: 'Sandbox environment with name create-only-env already exists' },
    });

    const getRes = await publicRouter.request('/create-only-env');
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: { description: string; manifest: { image?: { build_script?: string } } };
    };
    expect(getBody.data.description).toBe('first');
    expect(getBody.data.manifest.image?.build_script).toBe('pip install httpx');
  });

  it('lists environments for the caller without error when none exist yet', async () => {
    const { publicRouter } = await setup();
    const listRes = await publicRouter.request('/');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: unknown[] };
    expect(Array.isArray(listBody.data)).toBe(true);
  });

  it('allows all users to read; create/update/delete are admin-only', async () => {
    const { publicRouter, setSubject } = await setup();
    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);

    setSubject('alice', ['admin']);
    const body = {
      manifest: {
        name: 'shared-env',
        description: 'created by alice',
        image: { type: 'build', build_script: 'pip install httpx' },
      },
    };
    expect(
      (
        await publicRouter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(201);

    // Creator loses write access without the admin role.
    setSubject('alice', ['everyone']);
    const creatorUpdate = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'shared-env',
          description: 'updated by creator',
          image: { type: 'build', build_script: 'pip install httpx' },
        },
      }),
    });
    expect(creatorUpdate.status).toBe(403);

    setSubject('bob', ['everyone']);
    const listed = (await (await publicRouter.request('/')).json()) as { data: { name: string }[] };
    expect(listed.data.map(environment => environment.name)).toContain('shared-env');
    expect((await publicRouter.request('/shared-env')).status).toBe(200);
    expect(
      (
        await publicRouter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            manifest: {
              name: 'bob-env',
              description: 'denied',
              image: { type: 'build', build_script: 'pip install httpx' },
            },
          }),
        })
      ).status,
    ).toBe(403);

    const update = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(update.status).toBe(403);
    expect(await update.json()).toEqual({
      error: { message: 'User does not have permission to edit Sandbox environment' },
    });

    const remove = await publicRouter.request('/shared-env', { method: 'DELETE' });
    expect(remove.status).toBe(403);
    expect(await remove.json()).toEqual({
      error: { message: 'User does not have permission to edit Sandbox environment' },
    });

    setSubject('carol', ['admin']);
    const adminUpdate = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'shared-env',
          description: 'updated by carol',
          image: { type: 'build', build_script: 'pip install requests' },
        },
      }),
    });
    expect(adminUpdate.status).toBe(200);
    expect(((await adminUpdate.json()) as { data: { description: string } }).data.description).toBe('updated by carol');
    expect((await publicRouter.request('/shared-env', { method: 'DELETE' })).status).toBe(200);
  });

  it('in TrueFoundry mode create/update/delete are tenant-admin only', async () => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    const { publicRouter, setSubject } = await setup();
    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue({
      envSupported: true,
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never);

    setSubject('bob', ['everyone']);
    expect(
      (
        await publicRouter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            manifest: {
              name: 'bob-env',
              description: 'denied',
              image: { type: 'build', build_script: 'pip install httpx' },
            },
          }),
        })
      ).status,
    ).toBe(403);

    setSubject('alice', [TRUEFOUNDRY_TENANT_ADMIN_ROLE]);
    const body = {
      manifest: {
        name: 'tfy-env',
        description: 'created by alice',
        image: { type: 'build', build_script: 'pip install httpx' },
      },
    };
    expect(
      (
        await publicRouter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(201);

    setSubject('alice', ['everyone']);
    const creatorUpdate = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'tfy-env',
          description: 'updated by creator',
          image: { type: 'build', build_script: 'pip install httpx' },
        },
      }),
    });
    expect(creatorUpdate.status).toBe(403);

    setSubject('bob', ['everyone']);
    expect((await publicRouter.request('/tfy-env')).status).toBe(200);
    expect(
      (
        await publicRouter.request('/', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);

    setSubject('carol', [TRUEFOUNDRY_TENANT_ADMIN_ROLE]);
    const update = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'tfy-env',
          description: 'updated by carol',
          image: { type: 'build', build_script: 'pip install requests' },
        },
      }),
    });
    expect(update.status).toBe(200);
    expect(((await update.json()) as { data: { description: string } }).data.description).toBe('updated by carol');

    expect((await publicRouter.request('/tfy-env', { method: 'DELETE' })).status).toBe(200);
    expect((await publicRouter.request('/tfy-env')).status).toBe(404);
  });
  function mockSecretProvider() {
    // Both resolvers, so these tests do not depend on a mock another test left behind.
    const provider = {
      createSecret: jest.fn(),
      updateSecret: jest.fn(),
      deleteSecret: jest.fn(),
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never;
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue(provider);
    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue(provider);
  }

  async function writeEnv(
    publicRouter: Awaited<ReturnType<typeof setup>>['publicRouter'],
    { method, build_script }: { method: 'POST' | 'PUT'; build_script: string },
  ) {
    return publicRouter.request('/', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: { name: 'identity-env', image: { type: 'build', build_script } },
      }),
    });
  }

  it.each(['POST', 'PUT'] as const)('%s rejects build scripts above the configured limit', async method => {
    const { publicRouter } = await setup();

    const response = await writeEnv(publicRouter, { method, build_script: 'x'.repeat(20_001) });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Sandbox environment build script exceeds configured limit');
  });

  it('stores type equal to the provider outside TrueFoundry mode', async () => {
    const { publicRouter, sandboxEnvironmentStore } = await setup();
    mockSecretProvider();

    expect((await writeEnv(publicRouter, { method: 'POST', build_script: 'pip install httpx' })).status).toBe(201);
    const stored = await sandboxEnvironmentStore.getEnvironment({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'identity-env',
    });
    expect(stored?.version.manifest).toMatchObject({ type: 'daytona', sandbox_provider: 'daytona' });
  });

  it('in TrueFoundry mode POST and PUT store type truefoundry with the backing sandbox_provider', async () => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(true);
    const { publicRouter, sandboxEnvironmentStore, setSubject } = await setup();
    mockSecretProvider();
    setSubject('alice', [TRUEFOUNDRY_TENANT_ADMIN_ROLE]);
    const load = () =>
      sandboxEnvironmentStore.getEnvironment({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        name: 'identity-env',
      });

    const created = await writeEnv(publicRouter, { method: 'POST', build_script: 'pip install httpx' });
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain('sandbox_provider');
    expect((await load())?.version.manifest).toMatchObject({ type: 'truefoundry', sandbox_provider: 'daytona' });

    expect((await writeEnv(publicRouter, { method: 'PUT', build_script: 'pip install requests' })).status).toBe(200);
    const updated = await load();
    expect(updated?.version.version).toBe(2);
    expect(updated?.version.manifest).toMatchObject({ type: 'truefoundry', sandbox_provider: 'daytona' });
  });

  async function createEnv(publicRouter: Awaited<ReturnType<typeof setup>>['publicRouter'], name: string) {
    const res = await publicRouter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { name, image: { type: 'build', build_script: 'pip install httpx' } } }),
    });
    expect(res.status).toBe(201);
    return res;
  }

  async function patchFlags(
    publicRouter: Awaited<ReturnType<typeof setup>>['publicRouter'],
    name: string,
    body: { enabled?: boolean; is_default?: boolean },
  ) {
    return publicRouter.request(`/${name}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('PATCH moves only the flags', async () => {
    const { publicRouter } = await setup();
    mockSecretProvider();
    await createEnv(publicRouter, 'flag-env');

    const setDefault = await patchFlags(publicRouter, 'flag-env', { is_default: true });
    expect(setDefault.status).toBe(200);
    const defaulted = (await setDefault.json()) as { data: { is_default: boolean; enabled: boolean; status: string } };
    expect(defaulted.data).toMatchObject({ is_default: true, enabled: true, status: 'pending' });

    // The default cannot be deleted while it holds the flag.
    expect((await publicRouter.request('/flag-env', { method: 'DELETE' })).status).toBe(409);

    await createEnv(publicRouter, 'other-env');
    expect((await patchFlags(publicRouter, 'other-env', { is_default: true })).status).toBe(200);

    const disabled = await patchFlags(publicRouter, 'flag-env', { enabled: false });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()) as { data: { enabled: boolean } }).toMatchObject({ data: { enabled: false } });

    // A disabled environment cannot take the default slot; the store refuses under its own lock.
    const disabledDefault = await patchFlags(publicRouter, 'flag-env', { is_default: true });
    expect(disabledDefault.status).toBe(409);
    expect(await disabledDefault.json()).toEqual({
      error: { message: 'Sandbox environment "flag-env" is disabled; enable it first' },
    });

    const enabled = await patchFlags(publicRouter, 'flag-env', { enabled: true });
    expect(enabled.status).toBe(200);
    expect((await enabled.json()) as { data: { enabled: boolean } }).toMatchObject({ data: { enabled: true } });

    // Only one environment holds the flag.
    const listed = (await (await publicRouter.request('/')).json()) as {
      data: { name: string; is_default: boolean }[];
    };
    expect(listed.data.filter(env => env.is_default).map(env => env.name)).toEqual(['other-env']);
  });

  it('is_default and enabled both need the admin role', async () => {
    const { publicRouter, setSubject } = await setup();
    mockSecretProvider();
    setSubject('alice', ['admin']);
    await createEnv(publicRouter, 'flag-env');

    setSubject('alice', ['everyone']);
    const refusedDefault = await patchFlags(publicRouter, 'flag-env', { is_default: true });
    expect(refusedDefault.status).toBe(403);
    expect(await refusedDefault.json()).toEqual({
      error: { message: 'User does not have permission to edit Sandbox environment' },
    });
    expect((await patchFlags(publicRouter, 'flag-env', { enabled: false })).status).toBe(403);

    setSubject('carol', ['admin']);
    expect((await patchFlags(publicRouter, 'flag-env', { enabled: false })).status).toBe(200);
    expect((await patchFlags(publicRouter, 'flag-env', { enabled: true })).status).toBe(200);
    const allowed = await patchFlags(publicRouter, 'flag-env', { is_default: true });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()) as { data: { is_default: boolean } }).toMatchObject({ data: { is_default: true } });
  });

  it('refuses to disable the environment holding the default slot', async () => {
    const { publicRouter } = await setup();
    mockSecretProvider();
    await createEnv(publicRouter, 'flag-env');
    expect((await patchFlags(publicRouter, 'flag-env', { is_default: true })).status).toBe(200);

    const disabled = await patchFlags(publicRouter, 'flag-env', { enabled: false });
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toEqual({
      error: {
        message:
          'Sandbox environment "flag-env" is the default and cannot be disabled. Make another one the default first.',
      },
    });
    const listed = (await (await publicRouter.request('/')).json()) as {
      data: { name: string; is_default: boolean; enabled: boolean }[];
    };
    expect(listed.data.find(env => env.name === 'flag-env')).toMatchObject({
      is_default: true,
      enabled: true,
    });
  });

  it('answers 409 when a set-default lands between the delete pre-check and the store write', async () => {
    const { db, publicRouter, sandboxEnvironmentStore, setDuringDeletePreChecks } = await setup();
    const deleteSecret = jest.fn();
    const provider = {
      envSupported: true,
      createSecret: jest.fn().mockResolvedValue({ id: 'daytona-sec-1' }),
      updateSecret: jest.fn(),
      deleteSecret,
      getBuildStatus: jest.fn(),
      build: jest.fn(),
    } as never;
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue(provider);
    jest.mocked(providerUtils.toSandboxProviderFromRecord).mockReturnValue(provider);
    const created = await publicRouter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: 'flag-env',
          image: { type: 'build', build_script: 'pip install httpx' },
          networking: { secrets: [{ env: 'API_TOKEN', value: 'secret-value', hosts: ['api.example.com'] }] },
        },
      }),
    });
    expect(created.status).toBe(201);
    await createEnv(publicRouter, 'other-env');
    expect((await patchFlags(publicRouter, 'other-env', { is_default: true })).status).toBe(200);

    // The delete pre-check has already seen flag-env as non-default when this commits.
    setDuringDeletePreChecks(async () => {
      await sandboxEnvironmentStore.setDefaultEnvironment({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        name: 'flag-env',
      });
    });

    const removed = await publicRouter.request('/flag-env', { method: 'DELETE' });
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual({
      error: { message: 'Sandbox environment "flag-env" is the default and cannot be deleted' },
    });
    expect(deleteSecret).not.toHaveBeenCalled();

    // The tenant keeps its default, and the provider secret, instead of losing both to the delete.
    const kept = await db
      .selectFrom('sandbox_environment')
      .select(['id', 'lifecycle_stage', 'is_default'])
      .where('tenant_id', '=', STANDALONE_REQUEST_CONTEXT.tenant_id)
      .where('name', '=', 'flag-env')
      .executeTakeFirstOrThrow();
    expect(kept).toMatchObject({ lifecycle_stage: 'active', is_default: 1 });
    const secretRows = await db
      .selectFrom('sandbox_environment_secret')
      .select(['external_secret_id'])
      .where('environment_id', '=', kept.id)
      .execute();
    expect(secretRows).toEqual([{ external_secret_id: 'daytona-sec-1' }]);
  });

  it('refuses to edit or delete the reserved "default" environment', async () => {
    const { publicRouter } = await setup();

    const deleted = await publicRouter.request('/default', { method: 'DELETE' });
    expect(deleted.status).toBe(409);
    expect((await deleted.json()) as { error: { message: string } }).toMatchObject({
      error: { message: 'Sandbox environment "default" cannot be deleted' },
    });

    const edited = await publicRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { name: 'default', description: 'changed' } }),
    });
    expect(edited.status).toBe(400);
  });

  it('answers 404 for flag changes on an unknown environment', async () => {
    const { publicRouter } = await setup();

    expect((await patchFlags(publicRouter, 'missing-env', { enabled: true })).status).toBe(404);
    expect((await patchFlags(publicRouter, 'missing-env', { enabled: false })).status).toBe(404);
    expect((await patchFlags(publicRouter, 'missing-env', { is_default: true })).status).toBe(404);
  });
});
