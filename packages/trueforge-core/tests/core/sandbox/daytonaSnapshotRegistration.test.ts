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

function makeRuntimeProvider(
  client: Daytona,
  onError?: (error: unknown) => Promise<void>,
  apiKey = 'dtn-test',
): DaytonaSandboxProvider {
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
    onError,
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
  it('reports sandbox creation errors before rethrowing them', async () => {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    jest.spyOn(client, 'create').mockRejectedValue(new DaytonaError('unauthorized', 401));
    const onError = jest.fn().mockResolvedValue(undefined);
    const provider = makeRuntimeProvider(client, onError);

    await expect(provider.createSandbox()).rejects.toMatchObject({ statusCode: 401 });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('reports provider errors before converting them to failed exec results', async () => {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    jest.spyOn(client, 'get').mockRejectedValue(new DaytonaError('unauthorized', 401));
    const onError = jest.fn().mockResolvedValue(undefined);
    const provider = makeRuntimeProvider(client, onError);

    await expect(provider.exec({ sandboxId: 'test-tenant.expired', command: 'true' })).resolves.toMatchObject({
      success: false,
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rethrows SandboxNotAvailableError when the sandbox is gone', async () => {
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    jest.spyOn(client, 'get').mockRejectedValue(new DaytonaError('not found', NOT_FOUND_STATUS));
    const provider = makeRuntimeProvider(client);

    await expect(provider.exec({ sandboxId: 'test-tenant.gone', command: 'true' })).rejects.toBeInstanceOf(
      SandboxNotAvailableError,
    );
  });

  it('does not reuse a restored sandbox after the Daytona credentials rotate', async () => {
    const sandboxId = 'test-tenant.rotated-credentials';
    const oldClient = new Daytona({ apiKey: 'dtn-old', useDeprecatedPolling: true });
    const newClient = new Daytona({ apiKey: 'dtn-new', useDeprecatedPolling: true });
    const oldSandbox = {
      state: 'started',
      process: { executeCommand: jest.fn().mockResolvedValue({ exitCode: 0, result: 'old' }) },
    };
    const newSandbox = {
      state: 'started',
      process: { executeCommand: jest.fn().mockResolvedValue({ exitCode: 0, result: 'new' }) },
    };
    jest.spyOn(oldClient, 'get').mockResolvedValue(oldSandbox as never);
    jest.spyOn(newClient, 'get').mockResolvedValue(newSandbox as never);

    await expect(
      makeRuntimeProvider(oldClient, undefined, 'dtn-old').exec({ sandboxId, command: 'true' }),
    ).resolves.toMatchObject({
      success: true,
      response: { result: 'old' },
    });
    await expect(
      makeRuntimeProvider(newClient, undefined, 'dtn-new').exec({ sandboxId, command: 'true' }),
    ).resolves.toMatchObject({
      success: true,
      response: { result: 'new' },
    });

    expect(oldClient.get).toHaveBeenCalledWith(sandboxId);
    expect(newClient.get).toHaveBeenCalledWith(sandboxId);
  });

  it.each([
    [
      'download',
      (provider: DaytonaSandboxProvider, sandboxId: string) => provider.downloadFile({ sandboxId, path: '/tmp/file' }),
    ],
    [
      'upload',
      (provider: DaytonaSandboxProvider, sandboxId: string) =>
        provider.uploadFile({ sandboxId, remotePath: '/tmp/file', content: Buffer.from('content') }),
    ],
    [
      'preview',
      (provider: DaytonaSandboxProvider, sandboxId: string) =>
        (
          provider as unknown as {
            getPreviewUrl(params: { sandboxId: string; port: number; expiresInSeconds: number }): Promise<string>;
          }
        ).getPreviewUrl({
          sandboxId,
          port: 3000,
          expiresInSeconds: 60,
        }),
    ],
  ])('evicts the credential-scoped cache entry when %s fails', async (_operation, run) => {
    const sandboxId = 'test-tenant.cached';
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    const provider = makeRuntimeProvider(client);
    const internals = DaytonaSandboxProvider as unknown as { cachedSandboxes: Map<string, unknown> };
    const cacheKey = (provider as unknown as { sandboxCacheKey(id: string): string }).sandboxCacheKey(sandboxId);
    const failingSandbox = {
      fs: {
        getFileDetails: jest.fn().mockResolvedValue({ size: 1, isDir: false }),
        downloadFile: jest.fn().mockRejectedValue(new Error('download failed')),
        uploadFile: jest.fn().mockRejectedValue(new Error('upload failed')),
      },
      getSignedPreviewUrl: jest.fn().mockRejectedValue(new Error('preview failed')),
    };
    internals.cachedSandboxes.set(cacheKey, { sandbox: failingSandbox, defaultTimeoutMs: 1000 });

    await expect(run(provider, sandboxId)).rejects.toThrow();

    expect(internals.cachedSandboxes.has(cacheKey)).toBe(false);
  });

  it.each([
    [
      'download',
      async (provider: DaytonaSandboxProvider, sandboxId: string) =>
        provider.downloadFile({ sandboxId, path: '/tmp/output' }),
    ],
    [
      'upload',
      async (provider: DaytonaSandboxProvider, sandboxId: string) =>
        provider.uploadFile({ sandboxId, remotePath: '/tmp/output', content: Buffer.from('content') }),
    ],
    [
      'preview',
      async (provider: DaytonaSandboxProvider, sandboxId: string) =>
        (
          provider as unknown as {
            getPreviewUrl(params: { sandboxId: string; port: number; expiresInSeconds: number }): Promise<string>;
          }
        ).getPreviewUrl({ sandboxId, port: 4222, expiresInSeconds: 60 }),
    ],
  ])('reports Daytona authentication failures from %s operations', async (_operation, invoke) => {
    const sandboxId = 'test-tenant.auth-failure';
    const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
    const unauthorized = new DaytonaError('unauthorized', 401);
    const sandbox = {
      state: 'started',
      fs: {
        getFileDetails: jest.fn().mockResolvedValue({ size: 1, isDir: false }),
        downloadFile: jest.fn().mockRejectedValue(unauthorized),
        uploadFile: jest.fn().mockRejectedValue(unauthorized),
      },
      getSignedPreviewUrl: jest.fn().mockRejectedValue(unauthorized),
    };
    jest.spyOn(client, 'get').mockResolvedValue(sandbox as never);
    const onError = jest.fn().mockResolvedValue(undefined);
    const provider = makeRuntimeProvider(client, onError);

    await expect(invoke(provider, sandboxId)).rejects.toMatchObject({ statusCode: 401 });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
