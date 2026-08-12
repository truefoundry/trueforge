/**
 * DaytonaSandboxProvider.buildImage / getImageBuildStatus behaviour against a
 * spied SDK client: snapshot state mapping, missing-snapshot semantics, and
 * fire-and-forget create. The image + snapshot ref are release-owned (derived
 * from SANDBOX_IMAGE_NAME), so the provider takes no image args. No network traffic.
 */
import { Daytona, DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '../../../../src/core/sandbox/provider/DaytonaProvider';
import { SANDBOX_IMAGE_NAME } from '../../../../src/core/sandbox/sandboxImage.gen';
import { makeSilentLogger } from '../../harnessMocks';

type DaytonaSnapshot = Awaited<ReturnType<Daytona['snapshot']['get']>>;

const EXPECTED_TAG = SANDBOX_IMAGE_NAME.slice(SANDBOX_IMAGE_NAME.lastIndexOf(':') + 1);
const EXPECTED_REF = `trueforge-snapshot-${EXPECTED_TAG}`;

function makeSnapshot(params: { state: DaytonaSnapshot['state']; errorReason?: string | null }): DaytonaSnapshot {
  return {
    id: 'snap-1',
    general: false,
    name: EXPECTED_REF,
    imageName: SANDBOX_IMAGE_NAME,
    state: params.state,
    size: null,
    entrypoint: null,
    cpu: 1,
    gpu: 0,
    mem: 2,
    disk: 10,
    errorReason: params.errorReason ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
    __brand: 'Snapshot',
  };
}

function makeProvider() {
  const daytona = new Daytona({ apiKey: 'dtn-test' });
  const get = jest.spyOn(daytona.snapshot, 'get');
  const create = jest.spyOn(daytona.snapshot, 'create');
  const del = jest.spyOn(daytona.snapshot, 'delete');
  const provider = new DaytonaSandboxProvider({
    client: daytona,
    tenantName: 'test-tenant',
    timeoutMs: 60_000,
    autoStopIntervalInMinutes: 5,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 7200,
    fileMaxBytesForDownload: 1024,
    logger: makeSilentLogger(),
  });
  return { provider, get, create, del };
}

const notFound = () => new DaytonaError('snapshot not found', 404);

describe('DaytonaSandboxProvider.buildImage', () => {
  it('fires a background create and reports pending when the snapshot is missing', async () => {
    const { provider, get, create } = makeProvider();
    get.mockRejectedValue(notFound());
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const build = await provider.buildImage();

    expect(build.status).toBe('pending');
    expect(build.errorMessage).toBeNull();
    expect(build.tag).toBe(EXPECTED_TAG);
    expect(build.ref).toBe(EXPECTED_REF);
    expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
  });

  it('adopts an existing active snapshot as ready without creating', async () => {
    const { provider, get, create } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state: 'active' }));

    const build = await provider.buildImage();

    expect(build.status).toBe('ready');
    expect(build.ref).toBe(EXPECTED_REF);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['error', 'build_failed'] as const)(
    'deletes a %s snapshot and recreates it, reporting pending',
    async state => {
      const { provider, get, create, del } = makeProvider();
      get.mockResolvedValue(makeSnapshot({ state, errorReason: 'image pull backoff' }));
      del.mockResolvedValue(undefined);
      create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

      const build = await provider.buildImage();

      expect(del).toHaveBeenCalledWith(makeSnapshot({ state, errorReason: 'image pull backoff' }));
      expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
      expect(build.status).toBe('pending');
      expect(build.errorMessage).toBeNull();
    },
  );

  it('tolerates a concurrent delete (404) when clearing a failed snapshot', async () => {
    const { provider, get, create, del } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state: 'build_failed' }));
    del.mockRejectedValue(notFound());
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const build = await provider.buildImage();

    expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
    expect(build.status).toBe('pending');
  });

  it('propagates a non-404 delete failure without recreating', async () => {
    const { provider, get, create, del } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state: 'error' }));
    del.mockRejectedValue(new DaytonaError('unauthorized', 401));

    await expect(provider.buildImage()).rejects.toMatchObject({ statusCode: 401 });
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates auth errors from the initial lookup', async () => {
    const { provider, get } = makeProvider();
    get.mockRejectedValue(new DaytonaError('unauthorized', 401));

    await expect(provider.buildImage()).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('DaytonaSandboxProvider.getImageBuildStatus', () => {
  it.each([
    ['active', 'ready'],
    ['pending', 'pending'],
    ['building', 'pending'],
    ['pulling', 'pending'],
    ['removing', 'pending'],
    // Reactivation of parked snapshots is deferred; inactive reports pending for now.
    ['inactive', 'pending'],
  ] as const)('maps snapshot state %s to %s', async (state, expected) => {
    const { provider, get } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state }));

    const build = await provider.getImageBuildStatus();
    expect(build.status).toBe(expected);
    expect(build.tag).toBe(EXPECTED_TAG);
    expect(build.ref).toBe(EXPECTED_REF);
  });

  it.each(['error', 'build_failed'] as const)('maps snapshot state %s to failed with the reason', async state => {
    const { provider, get } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state, errorReason: 'image pull backoff' }));

    const build = await provider.getImageBuildStatus();
    expect(build.status).toBe('failed');
    expect(build.errorMessage).toBe('image pull backoff');
  });

  it('is read-only: a missing snapshot reports pending without creating one', async () => {
    const { provider, get, create } = makeProvider();
    get.mockRejectedValue(notFound());

    const build = await provider.getImageBuildStatus();

    expect(build.status).toBe('pending');
    expect(build.ref).toBe(EXPECTED_REF);
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates auth errors', async () => {
    const { provider, get } = makeProvider();
    get.mockRejectedValue(new DaytonaError('unauthorized', 401));

    await expect(provider.getImageBuildStatus()).rejects.toMatchObject({ statusCode: 401 });
  });
});
