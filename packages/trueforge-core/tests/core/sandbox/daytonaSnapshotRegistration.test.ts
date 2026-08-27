import { Daytona, DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '../../../src/core/sandbox/provider/DaytonaProvider';
import { SandboxNotAvailableError } from '../../../src/core/sandbox/SandboxErrors';
import { makeSilentLogger } from '../harnessMocks';

const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;
const FORBIDDEN_STATUS = 403;
const API_URL = 'https://daytona.test/api';

/**
 * Builds a provider whose snapshot lookup reports "not built yet" so `buildImage` always reaches
 * the register-only POST.
 */
function makeProvider({ apiKey = 'dtn-test' }: { apiKey?: string } = {}): DaytonaSandboxProvider {
  // useDeprecatedPolling keeps the constructor from opening the event-stream WebSocket.
  const client = new Daytona({ apiKey, useDeprecatedPolling: true });
  jest.spyOn(client.snapshot, 'get').mockRejectedValue(new DaytonaError('not found', NOT_FOUND_STATUS));

  return new DaytonaSandboxProvider({
    client,
    apiKey,
    apiUrl: API_URL,
    tenantName: 'test-tenant',
    sandboxImage: 'registry.example.com/sandbox:029ea5ff',
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
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
    );
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

    const build = await makeProvider().buildImage();

    expect(build.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/snapshots`);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ imageName: 'registry.example.com/sandbox:029ea5ff' });
    expect(body).toHaveProperty('name', expect.stringMatching(/^trueforge-build-[a-f0-9]{40}$/));
  });

  it('scopes derived build names to the Daytona credential', async () => {
    const fetchMock = mockFetch({
      status: 200,
      body: { id: 'snap-1', state: 'pending', errorReason: null },
    });

    await makeProvider({ apiKey: 'dtn-account-one' }).buildImage();
    await makeProvider({ apiKey: 'dtn-account-two' }).buildImage();

    const firstBody: unknown = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody: unknown = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody).toMatchObject({ name: expect.stringMatching(/^trueforge-build-[a-f0-9]{40}$/) });
    expect(secondBody).toMatchObject({ name: expect.stringMatching(/^trueforge-build-[a-f0-9]{40}$/) });
    expect(firstBody).not.toEqual(secondBody);
  });

  it('treats a concurrent-create conflict as pending, not a thrown failure', async () => {
    mockFetch({ status: CONFLICT_STATUS, body: { statusCode: CONFLICT_STATUS, message: 'Conflict' } });

    const build = await makeProvider().buildImage();

    expect(build.status).toBe('pending');
  });

  it('throws on Access denied so PUT can map it to 422', async () => {
    mockFetch({ status: FORBIDDEN_STATUS, body: { statusCode: FORBIDDEN_STATUS, message: 'Access denied' } });

    await expect(makeProvider().buildImage()).rejects.toMatchObject({
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
      sandboxImage: 'registry.example.com/sandbox:029ea5ff',
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
