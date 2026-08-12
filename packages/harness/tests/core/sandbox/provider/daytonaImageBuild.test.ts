/**
 * DaytonaSandboxProvider.buildImage / getImageBuildStatus behaviour against a
 * spied SDK client: build-state mapping, missing-build semantics, fire-and-forget
 * create, failed-build recreation, inactive reactivation, and concurrency dedupe.
 * The image reference is passed in at construction. No network traffic.
 */
import { Daytona, DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '../../../../src/core/sandbox/provider/DaytonaProvider';
import { SANDBOX_IMAGE_NAME } from '../../../../src/core/sandbox/sandboxImage';
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

function makeProvider(credentialFingerprint = 'fp-default') {
  const daytona = new Daytona({ apiKey: 'dtn-test' });
  const get = jest.spyOn(daytona.snapshot, 'get');
  const create = jest.spyOn(daytona.snapshot, 'create');
  const del = jest.spyOn(daytona.snapshot, 'delete');
  const activate = jest.spyOn(daytona.snapshot, 'activate');
  const provider = new DaytonaSandboxProvider({
    client: daytona,
    tenantName: 'test-tenant',
    sandboxImage: SANDBOX_IMAGE_NAME,
    credentialFingerprint,
    timeoutMs: 60_000,
    autoStopIntervalInMinutes: 5,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 7200,
    fileMaxBytesForDownload: 1024,
    logger: makeSilentLogger(),
  });
  return { provider, get, create, del, activate };
}

const notFound = () => new DaytonaError('snapshot not found', 404);

describe('DaytonaSandboxProvider.buildImage', () => {
  it('fires a background create and reports pending when the build is missing', async () => {
    const { provider, get, create } = makeProvider();
    get.mockRejectedValue(notFound());
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const build = await provider.buildImage();

    expect(build.status).toBe('pending');
    expect(build.metadata).toEqual({ buildRef: EXPECTED_REF, imageTag: EXPECTED_TAG });
    expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
  });

  it('adopts an existing active build as ready without creating', async () => {
    const { provider, get, create } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state: 'active' }));

    const build = await provider.buildImage();

    expect(build.status).toBe('ready');
    expect(build.reason).toBeNull();
    expect(build.metadata.buildRef).toBe(EXPECTED_REF);
    expect(create).not.toHaveBeenCalled();
  });

  it('reactivates a parked (inactive) build instead of rebuilding', async () => {
    const { provider, get, create, activate } = makeProvider();
    const parked = makeSnapshot({ state: 'inactive' });
    get.mockResolvedValue(parked);
    activate.mockResolvedValue(makeSnapshot({ state: 'active' }));

    const build = await provider.buildImage();

    expect(activate).toHaveBeenCalledWith(parked);
    expect(create).not.toHaveBeenCalled();
    expect(build.status).toBe('ready');
  });

  it.each(['error', 'build_failed'] as const)('deletes a %s build and recreates it, reporting pending', async state => {
    const { provider, get, create, del } = makeProvider();
    const failed = makeSnapshot({ state, errorReason: 'image pull backoff' });
    get.mockResolvedValue(failed);
    del.mockResolvedValue(undefined);
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const build = await provider.buildImage();

    expect(del).toHaveBeenCalledWith(failed);
    expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
    expect(build.status).toBe('pending');
  });

  it('tolerates a concurrent delete (404) when clearing a failed build', async () => {
    const { provider, get, create, del } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state: 'build_failed' }));
    del.mockRejectedValue(notFound());
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const build = await provider.buildImage();

    expect(create).toHaveBeenCalledWith({ name: EXPECTED_REF, image: SANDBOX_IMAGE_NAME });
    expect(build.status).toBe('pending');
  });

  it('dedupes concurrent build requests to a single create', async () => {
    const { provider, get, create } = makeProvider();
    get.mockRejectedValue(notFound());
    create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    const [a, b] = await Promise.all([provider.buildImage(), provider.buildImage()]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('pending');
    expect(b.status).toBe('pending');
  });

  it('does not dedupe builds across different credentials', async () => {
    const a = makeProvider('fp-key-a');
    const b = makeProvider('fp-key-b');
    a.get.mockRejectedValue(notFound());
    b.get.mockRejectedValue(notFound());
    a.create.mockResolvedValue(makeSnapshot({ state: 'pending' }));
    b.create.mockResolvedValue(makeSnapshot({ state: 'pending' }));

    await Promise.all([a.provider.buildImage(), b.provider.buildImage()]);

    // Each credential must run its own lookup + create so both keys get validated independently.
    expect(a.get).toHaveBeenCalledTimes(1);
    expect(b.get).toHaveBeenCalledTimes(1);
    expect(a.create).toHaveBeenCalledTimes(1);
    expect(b.create).toHaveBeenCalledTimes(1);
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
    // Read-only status never reactivates; a parked build reports pending until buildImage runs.
    ['inactive', 'pending'],
  ] as const)('maps build state %s to %s', async (state, expected) => {
    const { provider, get } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state }));

    const build = await provider.getImageBuildStatus();
    expect(build.status).toBe(expected);
    expect(build.metadata).toEqual({ buildRef: EXPECTED_REF, imageTag: EXPECTED_TAG });
  });

  it.each(['error', 'build_failed'] as const)('maps build state %s to failed with the reason', async state => {
    const { provider, get } = makeProvider();
    get.mockResolvedValue(makeSnapshot({ state, errorReason: 'image pull backoff' }));

    const build = await provider.getImageBuildStatus();
    expect(build.status).toBe('failed');
    expect(build.reason).toBe('image pull backoff');
  });

  it('is read-only: a missing build reports pending without creating one', async () => {
    const { provider, get, create } = makeProvider();
    get.mockRejectedValue(notFound());

    const build = await provider.getImageBuildStatus();

    expect(build.status).toBe('pending');
    expect(build.metadata.buildRef).toBe(EXPECTED_REF);
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates auth errors', async () => {
    const { provider, get } = makeProvider();
    get.mockRejectedValue(new DaytonaError('unauthorized', 401));

    await expect(provider.getImageBuildStatus()).rejects.toMatchObject({ statusCode: 401 });
  });
});
