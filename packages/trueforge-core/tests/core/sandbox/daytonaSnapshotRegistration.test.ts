import { Daytona, DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '../../../src/core/sandbox/provider/DaytonaProvider';
import { createDaytonaSandboxEnvironment } from '../../../src/core/sandbox/provider/DaytonaSandboxEnvironment';
import { SandboxNotAvailableError } from '../../../src/core/sandbox/SandboxErrors';
import { makeSilentLogger } from '../harnessMocks';

const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;
const FORBIDDEN_STATUS = 403;
const API_URL = 'https://daytona.test/api';

const DEFAULT_TEST_ENVIRONMENT = createDaytonaSandboxEnvironment({
  snapshot_ref: 'trueforge-build-029ea5ff',
  image_uri: 'registry.example.com/sandbox:029ea5ff',
  resources: { cpu: 1, memory: 1, disk: 3 },
});

/**
 * Builds a provider whose snapshot lookup reports "not built yet" so provider.build
 * always reaches the register-only POST.
 */
function makeProvider(): DaytonaSandboxProvider {
  // useDeprecatedPolling keeps the constructor from opening the event-stream WebSocket.
  const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
  jest.spyOn(client.snapshot, 'get').mockRejectedValue(new DaytonaError('not found', NOT_FOUND_STATUS));

  return new DaytonaSandboxProvider({
    client,
    apiKey: 'dtn-test',
    apiUrl: API_URL,
    tenantName: 'test-tenant',
    timeoutMs: 1000,
    autoStopIntervalInMinutes: 5,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 7200,
    fileMaxBytesForDownload: 1024,
    logger: makeSilentLogger(),
  });
}

function mockFetch({ status, body }: { status: number; body: unknown }): jest.SpiedFunction<typeof globalThis.fetch> {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DaytonaSandboxProvider register-only snapshot create', () => {
  it('awaits the register POST and returns pending without polling to active', async () => {
    const fetchMock = mockFetch({
      status: 200,
      body: { id: 'snap-1', name: 'trueforge-build-029ea5ff', state: 'pending', errorReason: null },
    });

    const build = await makeProvider().build(DEFAULT_TEST_ENVIRONMENT);

    expect(build.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/snapshots`);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'trueforge-build-029ea5ff',
      imageName: 'registry.example.com/sandbox:029ea5ff',
      cpu: 1,
      memory: 1,
      disk: 3,
    });
  });

  it('sends build_script as Dockerfile buildInfo layered on the base image', async () => {
    const fetchMock = mockFetch({
      status: 200,
      body: { id: 'snap-2', name: 'env-with-script', state: 'pending', errorReason: null },
    });
    const buildScript = 'set -ex\npip install httpx\n';
    const environment = createDaytonaSandboxEnvironment({
      snapshot_ref: 'env-with-script',
      image_uri: 'registry.example.com/sandbox:029ea5ff',
      resources: { cpu: 2, memory: 4, disk: 10 },
      image: { type: 'build', build_script: buildScript },
    });

    await makeProvider().build(environment);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: 'env-with-script',
      cpu: 2,
      memory: 4,
      disk: 10,
      buildInfo: {
        dockerfileContent: `FROM registry.example.com/sandbox:029ea5ff\nRUN ["bash", "-lc", ${JSON.stringify(buildScript)}]`,
      },
    });
  });

  it('treats a concurrent-create conflict as pending, not a thrown failure', async () => {
    mockFetch({ status: CONFLICT_STATUS, body: { statusCode: CONFLICT_STATUS, message: 'Conflict' } });

    const build = await makeProvider().build(DEFAULT_TEST_ENVIRONMENT);

    expect(build.status).toBe('pending');
  });

  it('throws on Access denied so PUT can map it to 422', async () => {
    mockFetch({ status: FORBIDDEN_STATUS, body: { statusCode: FORBIDDEN_STATUS, message: 'Access denied' } });

    await expect(makeProvider().build(DEFAULT_TEST_ENVIRONMENT)).rejects.toMatchObject({
      message: 'Access denied',
      statusCode: FORBIDDEN_STATUS,
    });
  });
});

describe('DaytonaSandboxProvider exec', () => {
  it('rethrows SandboxNotAvailableError when the sandbox is gone', async () => {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    jest.spyOn(client, 'get').mockRejectedValue(new DaytonaError('not found', NOT_FOUND_STATUS));
    const provider = new DaytonaSandboxProvider({
      client,
      apiKey: 'dtn-test',
      apiUrl: API_URL,
      tenantName: 'test-tenant',
      timeoutMs: 1000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
      fileMaxBytesForDownload: 1024,
      logger: makeSilentLogger(),
    });

    await expect(provider.exec({ sandboxId: 'test-tenant.gone', command: 'true' })).rejects.toBeInstanceOf(
      SandboxNotAvailableError,
    );
  });
});

describe('DaytonaSandboxProvider inactive snapshot create', () => {
  const UNAVAILABLE_MESSAGE =
    'The sandbox is temporarily unavailable and is being restored. Please try again in a few minutes.';

  type SnapshotStub = Awaited<ReturnType<Daytona['snapshot']['get']>>;

  function snapshotStub(input: { name: string; state: string }): SnapshotStub {
    return { id: 'snap-1', name: input.name, state: input.state } as SnapshotStub;
  }

  function makeCreateProvider(): {
    provider: DaytonaSandboxProvider;
    client: Daytona;
    onCriticalAlert: jest.Mock;
  } {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    const onCriticalAlert = jest.fn();
    const provider = new DaytonaSandboxProvider({
      client,
      apiKey: 'dtn-test',
      apiUrl: API_URL,
      tenantName: 'test-tenant',
      timeoutMs: 1000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
      fileMaxBytesForDownload: 1024,
      logger: makeSilentLogger(),
      onCriticalAlert,
    });
    return { provider, client, onCriticalAlert };
  }

  function environmentWithSnapshotRef(snapshot_ref: string) {
    return createDaytonaSandboxEnvironment({
      snapshot_ref,
      image_uri: 'registry.example.com/sandbox:029ea5ff',
      resources: { cpu: 1, memory: 1, disk: 3 },
    });
  }

  it('activates an inactive snapshot before create, then fails with a clear message', async () => {
    const { provider, client, onCriticalAlert } = makeCreateProvider();
    const environment = environmentWithSnapshotRef('inactive-before-create');
    const inactive = snapshotStub({ name: environment.snapshot_ref, state: 'inactive' });
    jest.spyOn(client.snapshot, 'get').mockResolvedValue(inactive);
    const activate = jest.spyOn(client.snapshot, 'activate').mockResolvedValue(inactive);
    const create = jest.spyOn(client, 'create');

    await expect(provider.createSandbox(environment)).rejects.toThrow(UNAVAILABLE_MESSAGE);

    expect(activate).toHaveBeenCalledWith(inactive);
    expect(create).not.toHaveBeenCalled();
    expect(onCriticalAlert).toHaveBeenCalledTimes(1);
  });

  it('does not alert on create permission errors', async () => {
    const { provider, client, onCriticalAlert } = makeCreateProvider();
    const environment = environmentWithSnapshotRef('create-forbidden');
    jest
      .spyOn(client.snapshot, 'get')
      .mockResolvedValue(snapshotStub({ name: environment.snapshot_ref, state: 'active' }));
    const activate = jest.spyOn(client.snapshot, 'activate');
    jest.spyOn(client, 'create').mockRejectedValue(new DaytonaError('Access denied', FORBIDDEN_STATUS));

    await expect(provider.createSandbox(environment)).rejects.toMatchObject({
      message: 'Access denied',
      statusCode: FORBIDDEN_STATUS,
    });

    expect(activate).not.toHaveBeenCalled();
    expect(onCriticalAlert).not.toHaveBeenCalled();
  });

  it('alerts P1 on non-authz create failures when the snapshot is not inactive', async () => {
    const { provider, client, onCriticalAlert } = makeCreateProvider();
    const environment = environmentWithSnapshotRef('create-failed-other');
    jest
      .spyOn(client.snapshot, 'get')
      .mockResolvedValue(snapshotStub({ name: environment.snapshot_ref, state: 'active' }));
    const createError = new DaytonaError('quota exceeded', 429);
    jest.spyOn(client, 'create').mockRejectedValue(createError);

    await expect(provider.createSandbox(environment)).rejects.toBe(createError);
    expect(onCriticalAlert).toHaveBeenCalledWith(createError);
  });

  it('alerts and rethrows when activate itself fails', async () => {
    const { provider, client, onCriticalAlert } = makeCreateProvider();
    const environment = environmentWithSnapshotRef('inactive-activate-failed');
    const inactive = snapshotStub({ name: environment.snapshot_ref, state: 'inactive' });
    jest.spyOn(client.snapshot, 'get').mockResolvedValue(inactive);
    const activateError = new DaytonaError('activate failed', 500);
    jest.spyOn(client.snapshot, 'activate').mockRejectedValue(activateError);
    const create = jest.spyOn(client, 'create');

    await expect(provider.createSandbox(environment)).rejects.toBe(activateError);

    expect(create).not.toHaveBeenCalled();
    expect(onCriticalAlert).toHaveBeenCalledWith(activateError);
  });
});
