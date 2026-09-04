import { Daytona, DaytonaError, type Sandbox } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '../../../src/core/sandbox/provider/DaytonaProvider';
import { SANDBOX_EXEC_ABORTED } from '../../../src/core/sandbox/provider/Provider';
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
function makeProvider(): DaytonaSandboxProvider {
  // useDeprecatedPolling keeps the constructor from opening the event-stream WebSocket.
  const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
  jest.spyOn(client.snapshot, 'get').mockRejectedValue(new DaytonaError('not found', NOT_FOUND_STATUS));

  return new DaytonaSandboxProvider({
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

    const build = await makeProvider().buildImage();

    expect(build.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/snapshots`);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'trueforge-build-029ea5ff',
      imageName: 'registry.example.com/sandbox:029ea5ff',
    });
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
  it('does not recover or retry when abort force-stops the exec sandbox', async () => {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    let rejectExecuteCommand: ((error: Error) => void) | undefined;
    const execStarted = new Promise<void>(resolve => {
      const executeCommand = jest.fn(
        (
          _command: string,
          _cwd: string | undefined,
          _env: Record<string, string>,
          _timeoutSeconds: number,
        ): Promise<{ exitCode: number; result: string }> => {
          resolve();
          return new Promise((_resolve, reject) => {
            rejectExecuteCommand = reject;
          });
        },
      );
      const sandbox: Sandbox = Object.assign(Object.create(null), {
        name: 'test-tenant.abort',
        state: 'started',
        process: { executeCommand },
        refreshData: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve()),
        stop: jest.fn(() => Promise.resolve()),
      });
      jest.spyOn(client, 'get').mockResolvedValue(sandbox);
    });
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
    const controller = new AbortController();

    const exec = provider.exec({
      sandboxId: 'test-tenant.abort',
      command: 'sleep 120',
      signal: controller.signal,
    });
    await execStarted;
    controller.abort();
    const reject = rejectExecuteCommand;
    if (reject === undefined) {
      throw new Error('executeCommand did not start');
    }
    reject(new DaytonaError('sandbox stopped', 500));

    await expect(exec).resolves.toEqual({ success: false, error: SANDBOX_EXEC_ABORTED });
    const sandbox = await client.get('test-tenant.abort');
    expect(sandbox.stop).toHaveBeenCalledWith(1, true);
    expect(sandbox.start).not.toHaveBeenCalled();
    expect(sandbox.refreshData).not.toHaveBeenCalled();
    expect(sandbox.process.executeCommand).toHaveBeenCalledTimes(1);
  });

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
