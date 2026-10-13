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
