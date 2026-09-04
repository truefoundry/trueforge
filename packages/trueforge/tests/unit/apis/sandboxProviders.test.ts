// Stub the Daytona-touching helpers so the router never talks to Daytona: the PUT path builds via
// toDaytonaSandboxProvider, and the GET path refreshes via checkSnapshotStatus. isDaytonaAuthError,
// isDaytonaPermissionError and toSandboxStatus stay real so the error mapping and PUT wire shape are
// exercised.
jest.mock('../../../src/sandbox/providerUtils', () => {
  const actual = jest.requireActual('../../../src/sandbox/providerUtils');
  return { ...actual, toDaytonaSandboxProvider: jest.fn(), checkSnapshotStatus: jest.fn() };
});

import { DaytonaError } from '@daytona/sdk';
import type { SandboxBuild } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { createCatalogRouter } from '../../../src/apis/catalog';
import { createSandboxProvidersRouter } from '../../../src/apis/sandboxProviders';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ISandboxProviderStore } from '../../../src/db/sandboxProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { checkSnapshotStatus, toDaytonaSandboxProvider } from '../../../src/sandbox/providerUtils';
import { toRedactedSecretValue } from '../../../src/utils/secretRedaction';

const mockProviderFactory = toDaytonaSandboxProvider as jest.Mock;
const mockCheckStatus = checkSnapshotStatus as jest.Mock;
const silentLogger = createLogger({ silent: true });

const putBody = {
  type: 'daytona' as const,
  auth: { api_key: 'dtn-test-secret' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

const IMAGE_URI = 'tfy.jfrog.io/tfy-images/truefoundry-utils-core-sandbox:029ea5ff';
const readyBuild: SandboxBuild = {
  status: 'ready',
  reason: null,
  metadata: { build_ref: 'trueforge-build-029ea5ff', image_uri: IMAGE_URI },
};
const expectedStatus = {
  status: 'ready' as const,
  status_reason: null,
};

/** Wire GET/PUT response: the (redacted) manifest nested under `manifest`, plus the build status. */
function wireResponse(manifest: Record<string, unknown>) {
  return { manifest, ...expectedStatus };
}

const putBodyWire = wireResponse({
  ...putBody,
  auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
});

function stubProvider(overrides: { buildImage?: jest.Mock; getImageBuildStatus?: jest.Mock } = {}) {
  return {
    buildImage: overrides.buildImage ?? jest.fn().mockResolvedValue(readyBuild),
    getImageBuildStatus: overrides.getImageBuildStatus ?? jest.fn().mockResolvedValue(readyBuild),
  };
}

function wrapManifest(manifest: unknown) {
  return { manifest };
}

function putInit(manifest: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(wrapManifest(manifest)),
  };
}

async function createRouters(): Promise<{
  settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;
  sandboxProviderStore: ISandboxProviderStore;
}> {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sandboxProviderStore = new SqliteSandboxProviderStore(db);
  return {
    settingsRouter: createSandboxProvidersRouter({
      resolveSandboxProviderStore: () => sandboxProviderStore,
      withTransaction: callback => db.transaction().execute(callback),
      logger: silentLogger,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    }),
    sandboxProviderStore,
  };
}

beforeEach(() => {
  mockProviderFactory.mockReset();
  mockProviderFactory.mockReturnValue(stubProvider());
  mockCheckStatus.mockReset();
  mockCheckStatus.mockResolvedValue(expectedStatus);
});

describe('sandboxProviders router', () => {
  let settingsRouter: ReturnType<typeof createSandboxProvidersRouter>;
  let catalogRouter: ReturnType<typeof createCatalogRouter>;
  // Concrete store keeps TTransaction as Transaction<Database>; the interface default is `never`.
  let sandboxProviderStore: SqliteSandboxProviderStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sandboxProviderStore = new SqliteSandboxProviderStore(db);
    settingsRouter = createSandboxProvidersRouter({
      resolveSandboxProviderStore: () => sandboxProviderStore,
      withTransaction: callback => db.transaction().execute(callback),
      logger: silentLogger,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
    });
  });

  it('GET /catalogs/sandbox-providers returns the shipped catalog verbatim', async () => {
    const response = await catalogRouter.request('/sandbox-providers');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [...SandboxCatalog.load().list()] });
  });

  it('GET / returns 404 when none configured', async () => {
    const response = await settingsRouter.request('/');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'No sandbox provider configured' } });
  });

  it('PUT builds the image + upserts, GET returns redacted auth plus live image status', async () => {
    const put = await settingsRouter.request('/', putInit(putBody));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ data: putBodyWire });

    const get = await settingsRouter.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ data: putBodyWire });

    const stored = await sandboxProviderStore.getSandboxProvider('default');
    expect(stored?.manifest).toEqual(putBody);
  });

  it('GET surfaces an error (500) when the status refresh throws', async () => {
    const { settingsRouter: router } = await createRouters();
    expect((await router.request('/', putInit(putBody))).status).toBe(200);

    mockCheckStatus.mockRejectedValue(new DaytonaError('unreachable', 500));
    const get = await router.request('/');
    expect(get.status).toBe(500);
  });

  it('PUT returns 422 when Daytona rejects the API key', async () => {
    mockProviderFactory.mockReturnValue(
      stubProvider({ buildImage: jest.fn().mockRejectedValue(new DaytonaError('unauthorized', 401)) }),
    );
    const response = await settingsRouter.request('/', putInit(putBody));
    expect(response.status).toBe(422);
  });

  it('PUT returns 422 naming the permissions when the key cannot register snapshots', async () => {
    mockProviderFactory.mockReturnValue(
      stubProvider({ buildImage: jest.fn().mockRejectedValue(new DaytonaError('Access denied', 403)) }),
    );
    const response = await settingsRouter.request('/', putInit(putBody));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        message:
          'Daytona denied access: the API key is missing required permissions. Grant write:sandboxes, write:snapshots, and delete:snapshots on the key in the Daytona dashboard, then try again.',
      },
    });
  });

  it('PUT does not persist config when the build call fails auth', async () => {
    const { settingsRouter: router } = await createRouters();
    mockProviderFactory.mockReturnValue(
      stubProvider({ buildImage: jest.fn().mockRejectedValue(new DaytonaError('forbidden', 403)) }),
    );
    expect((await router.request('/', putInit(putBody))).status).toBe(422);
    expect((await router.request('/')).status).toBe(404);
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { auth: _auth, ...withoutAuth } = putBody;
    const missingAuth = await settingsRouter.request('/', putInit(withoutAuth));
    expect(missingAuth.status).toBe(400);

    const badType = await settingsRouter.request('/', putInit({ ...putBody, type: 'unknown' }));
    expect(badType.status).toBe(400);

    const withSnapshotName = await settingsRouter.request('/', putInit({ ...putBody, snapshot_name: 'legacy' }));
    expect(withSnapshotName.status).toBe(400);
  });
});

describe('sandbox-provider secret redaction and strict PUT', () => {
  it('PUT create with a redacted api_key returns 400', async () => {
    const { settingsRouter } = await createRouters();
    const response = await settingsRouter.request(
      '/',
      putInit({
        ...putBody,
        auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'API key is required' } });
  });

  it('PUT with a redacted api_key keeps the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const redactedKeep = {
      ...putBody,
      exec_timeout_ms: 120000,
      auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) },
    };
    const update = await settingsRouter.request('/', putInit(redactedKeep));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ data: wireResponse(redactedKeep) });

    const stored = await sandboxProviderStore.getSandboxProvider('default');
    expect(stored?.manifest).toEqual({ ...putBody, exec_timeout_ms: 120000 });
  });

  it('PUT with a different redacted api_key still keeps the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const keep = {
      ...putBody,
      auth: { api_key: 'oth-***REDACTED***-xxx' },
    };
    const response = await settingsRouter.request('/', putInit(keep));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: wireResponse({ ...keep, auth: { api_key: toRedactedSecretValue(putBody.auth.api_key) } }),
    });

    const stored = await sandboxProviderStore.getSandboxProvider('default');
    expect(stored?.manifest).toEqual(putBody);
  });

  it('PUT with a real api_key rotates the stored secret', async () => {
    const { settingsRouter, sandboxProviderStore } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);

    const rotatedKey = 'dtn-rotated-key';
    const rotated = { ...putBody, auth: { api_key: rotatedKey } };
    const update = await settingsRouter.request('/', putInit(rotated));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({
      data: wireResponse({ ...rotated, auth: { api_key: toRedactedSecretValue(rotatedKey) } }),
    });

    const stored = await sandboxProviderStore.getSandboxProvider('default');
    expect(stored?.manifest.auth.api_key).toBe(rotatedKey);
  });

  it('PUT update reuses persisted build_metadata (no image upgrade on re-save)', async () => {
    const { settingsRouter } = await createRouters();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);
    expect(mockProviderFactory.mock.calls[0]?.[0]).not.toHaveProperty('build_metadata');

    mockProviderFactory.mockClear();
    expect((await settingsRouter.request('/', putInit(putBody))).status).toBe(200);
    expect(mockProviderFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        build_metadata: readyBuild.metadata,
      }),
    );
  });
});
