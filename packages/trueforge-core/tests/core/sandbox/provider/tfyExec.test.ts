import { TFYSandboxProvider } from '../../../../src/core/sandbox/provider/TFYSandboxProvider';
import { makeSilentLogger } from '../../harnessMocks';

const SANDBOX_ID = 'acme.00000000-0000-0000-0000-000000000001';
const LAYOUT = { success: true, response: { exitCode: 0, result: '/root\n/usr/bin\n' } };

function makeProvider(): TFYSandboxProvider {
  return new TFYSandboxProvider({
    serverUrl: 'http://sandbox.example',
    natsBridgeUrl: 'ws://nats.example',
    tenantName: 'acme',
    fileMaxBytesForDownload: 1024,
    logger: makeSilentLogger(),
  });
}

function mockExecResponse(body: () => Response): void {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(LAYOUT)))
    .mockImplementationOnce(() => Promise.resolve(body()));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TFYSandboxProvider.exec maxOutputBytes', () => {
  it('returns the result when the response fits', async () => {
    const result = { success: true, response: { exitCode: 0, result: 'ok' } };
    mockExecResponse(() => new Response(JSON.stringify(result)));

    await expect(
      makeProvider().exec({ sandboxId: SANDBOX_ID, command: 'echo ok', maxOutputBytes: 1024 }),
    ).resolves.toEqual(result);
  });

  it('stops reading and fails once the response exceeds the limit', async () => {
    let pulls = 0;
    let cancelled = false;
    mockExecResponse(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(512));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );

    await expect(makeProvider().exec({ sandboxId: SANDBOX_ID, command: 'yes', maxOutputBytes: 1024 })).resolves.toEqual(
      { success: false, error: 'Sandbox exec output exceeded 1024 bytes' },
    );
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });
});
