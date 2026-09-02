import type { ExecResult } from '../../../../src/core/sandbox/provider/Provider';
import { TFYSandboxProvider } from '../../../../src/core/sandbox/provider/TFYSandboxProvider';
import { SandboxFileNotFoundError } from '../../../../src/core/sandbox/SandboxErrors';
import { makeSilentLogger } from '../../harnessMocks';

const TENANT = 'acme';
const SANDBOX_ID = `${TENANT}.00000000-0000-0000-0000-000000000001`;
/** Mirrors TFY_DOWNLOAD_CHUNK_BYTES so tests can stage multi-window payloads. */
const CHUNK_BYTES = 2 * 1024 * 1024;

function makeProvider(fileMaxBytesForDownload: number): TFYSandboxProvider {
  return new TFYSandboxProvider({
    serverUrl: 'http://sandbox.example',
    natsBridgeUrl: 'ws://nats.example',
    tenantName: TENANT,
    fileMaxBytesForDownload,
    logger: makeSilentLogger(),
  });
}

function execOk(exitCode: number, result: string): ExecResult {
  return { success: true, response: { exitCode, result } };
}

/** Stages a queue of /exec JSON responses served by the mocked fetch, recording commands. */
function mockSandboxServer(responses: ExecResult[]): { commands: () => string[] } {
  const seen: string[] = [];
  const queue = [...responses];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { command: string };
    seen.push(body.command);
    return new Response(JSON.stringify(queue.shift()), { status: 200 });
  });
  return { commands: () => seen };
}

async function drain(download: Awaited<ReturnType<TFYSandboxProvider['downloadFile']>>): Promise<Buffer> {
  const reader = download.stream.getReader();
  const parts: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value);
  }
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

describe('TFYSandboxProvider downloadFile streaming', () => {
  it('pulls the file in byte windows and reassembles the exact bytes', async () => {
    // CHUNK_BYTES + 1 bytes forces two windows (second carries the final byte).
    const payload = Buffer.alloc(CHUNK_BYTES + 1);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = index % 253;
    }
    const server = mockSandboxServer([
      execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'),
      execOk(0, JSON.stringify({ size: payload.length, type: 'regular file' })),
      execOk(0, payload.subarray(0, CHUNK_BYTES).toString('base64')),
      execOk(0, payload.subarray(CHUNK_BYTES).toString('base64')),
    ]);
    const provider = makeProvider(16 * 1024 * 1024);

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'out/report.bin' });

    expect(download.size).toBe(payload.length);
    expect(Buffer.compare(await drain(download), payload)).toBe(0);

    const commands = server.commands();
    expect(commands[1]).toMatch(/^stat -L --printf=/);
    expect(commands[2]).toContain('tail -c +1');
    expect(commands[2]).toContain(`head -c ${String(CHUNK_BYTES)}`);
    expect(commands[3]).toContain(`tail -c +${String(CHUNK_BYTES + 1)}`);
    expect(commands).toHaveLength(4);
  });

  it('returns an empty stream for an empty file', async () => {
    mockSandboxServer([
      execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'),
      execOk(0, JSON.stringify({ size: 0, type: 'regular file' })),
    ]);
    const provider = makeProvider(1024);

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'empty.txt' });

    expect(download.size).toBe(0);
    expect((await drain(download)).length).toBe(0);
  });

  it('rejects missing files and directories before any chunk is pulled', async () => {
    const missing = mockSandboxServer([execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'), execOk(1, '')]);
    const missingProvider = makeProvider(1024);
    await expect(missingProvider.downloadFile({ sandboxId: SANDBOX_ID, path: 'gone.txt' })).rejects.toBeInstanceOf(
      SandboxFileNotFoundError,
    );
    expect(missing.commands()).toHaveLength(2);

    // Fresh provider so its layout probe runs and consumes this server's first response.
    const directory = mockSandboxServer([
      execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'),
      execOk(0, JSON.stringify({ size: 10, type: 'directory' })),
    ]);
    const directoryProvider = makeProvider(1024);
    await expect(directoryProvider.downloadFile({ sandboxId: SANDBOX_ID, path: 'a-dir' })).rejects.toMatchObject({
      name: 'SandboxPathIsDirectoryError',
    });
    expect(directory.commands()).toHaveLength(2);
  });

  it('fails mid-stream when a window comes back short (file mutated after stat)', async () => {
    mockSandboxServer([
      execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'),
      execOk(0, JSON.stringify({ size: 10, type: 'regular file' })),
      execOk(0, Buffer.from('short').toString('base64')),
    ]);
    const provider = makeProvider(1024);

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'shrank.txt' });
    await expect(drain(download)).rejects.toThrow(/changed during download/);
  });

  it('maps a first-window command failure to SandboxFileNotFoundError', async () => {
    mockSandboxServer([
      execOk(0, '/sandbox\n/usr/local/bin:/usr/bin:/bin'),
      execOk(0, JSON.stringify({ size: 100, type: 'regular file' })),
      execOk(127, ''),
    ]);
    const provider = makeProvider(1024);

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'vanished.txt' });
    await expect(drain(download)).rejects.toBeInstanceOf(SandboxFileNotFoundError);
  });
});
