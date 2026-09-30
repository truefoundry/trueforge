import { TFYSandboxProvider } from '../../../../src/core/sandbox/provider/TFYSandboxProvider';
import { makeSilentLogger } from '../../harnessMocks';

const SERVER_URL = 'http://sandbox.example';
const SANDBOX_ID = 'acme.00000000-0000-0000-0000-000000000001';

function makeProvider(): TFYSandboxProvider {
  return new TFYSandboxProvider({
    serverUrl: SERVER_URL,
    natsBridgeUrl: 'ws://nats.example',
    tenantName: 'acme',
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

describe('TFYSandboxProvider.uploadFile', () => {
  it('POSTs the raw bytes to /files/upload', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    const content = Buffer.from([0x00, 0xff, 0x0a]);

    await makeProvider().uploadFile({
      sandboxId: SANDBOX_ID,
      remotePath: 'uploads/report.docx',
      content,
    });

    expect(timeout).toHaveBeenCalledWith(30 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${SERVER_URL}/files/upload?sandbox_id=${SANDBOX_ID}&path=uploads%2Freport.docx`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
    expect(init?.body).toEqual(content);
    expect(init?.signal).toBe(timeout.mock.results[0]?.value);
  });

  it('throws the server error body when success is false', async () => {
    mockFetch({ status: 200, body: { success: false, error: 'File exceeds 26214400 bytes' } });

    await expect(
      makeProvider().uploadFile({
        sandboxId: SANDBOX_ID,
        remotePath: 'uploads/big.bin',
        content: Buffer.from('ok'),
      }),
    ).rejects.toThrow('File upload to sandbox failed: File exceeds 26214400 bytes');
  });

  it('rejects a sandbox that is not owned by the tenant', async () => {
    const fetchMock = mockFetch({ status: 200, body: { success: true } });

    await expect(
      makeProvider().uploadFile({
        sandboxId: 'other.00000000-0000-0000-0000-000000000001',
        remotePath: 'uploads/a.txt',
        content: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ name: 'SandboxTenantMismatchError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TFYSandboxProvider.exec abort', () => {
  it('aborts an in-flight exec when the turn signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, response: { exitCode: 0, result: '/sandbox\n/usr/bin' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return new Promise((_resolve, reject) => {
        const abort = (): void => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener('abort', abort, { once: true });
      });
    });

    const pending = makeProvider().exec({
      sandboxId: SANDBOX_ID,
      command: 'sleep 100',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toEqual({ success: false, error: 'Cancelled' });
  });
});
